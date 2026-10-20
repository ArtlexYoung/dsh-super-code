"""Account successful provider responses once; reasoning is an output subset."""
import json
from pathlib import Path


def calculate(path, started_ms, ended_ms, *, outages_path=None, suspensions_path=None):
    rows = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    requests = {r['sequence']: r for r in rows if r['event'] == 'request'}
    if not requests or any(r.get('model') != 'glm-5.3-flash' or r.get('reasoning_effort') != 'max' for r in requests.values()):
        raise ValueError('Model/reasoning identity mismatch or no requests')
    if any(r['event'] == 'identity-rejected' for r in rows):
        raise ValueError('Gateway rejected model/reasoning identity')
    terminals = {r['sequence']: r for r in rows if r['event'] == 'finished'}
    failures = {r['sequence']: r for r in rows if r['event'] == 'request-error'}
    responses = {r['sequence']: r for r in rows if r['event'] == 'response'}
    valid = []
    failed = []
    for key, request in requests.items():
        terminal = terminals.get(key, {})
        usage = terminal.get('usage')
        if terminal.get('type') in ('response.completed', 'response.incomplete') and not terminal.get('error_code') and isinstance(usage, dict):
            if terminal.get('model') != 'glm-5.3-flash':
                raise ValueError('Provider response model mismatch')
            assert usage['total_tokens'] == usage['input_tokens'] + usage['output_tokens']
            valid.append(terminal)
        else:
            failed.append((request, failures.get(key) or terminal or responses.get(key) or request))
    usage = {'model_calls': len(valid), 'input_tokens': 0, 'cached_input_tokens': 0,
             'uncached_input_tokens': 0, 'output_tokens': 0, 'reasoning_tokens': 0, 'total_tokens': 0}
    for row in valid:
        item = row['usage']
        cached = item.get('input_tokens_details', {}).get('cached_tokens', 0)
        reasoning = item.get('output_tokens_details', {}).get('reasoning_tokens', 0)
        assert 0 <= cached <= item['input_tokens'] and 0 <= reasoning <= item['output_tokens']
        for key in ('input_tokens', 'output_tokens', 'total_tokens'):
            usage[key] += item[key]
        usage['cached_input_tokens'] += cached
        usage['uncached_input_tokens'] += item['input_tokens'] - cached
        usage['reasoning_tokens'] += reasoning
    intervals = []
    if outages_path is not None and Path(outages_path).is_file():
        outages=json.loads(Path(outages_path).read_text())
        for row in outages['intervals']:
            intervals.append((max(started_ms,row['started_at_ms']),min(ended_ms,row.get('finished_at_ms',ended_ms))))
    if suspensions_path is not None and Path(suspensions_path).is_file():
        suspensions=json.loads(Path(suspensions_path).read_text())
        for row in suspensions['intervals']:
            intervals.append((max(started_ms,row['started_at_ms']),min(ended_ms,row['finished_at_ms'])))
    for request, end in failed:
        next_start = min((r['at_ms'] for r in requests.values() if r['at_ms'] > request['at_ms']), default=end.get('at_ms', ended_ms))
        intervals.append((max(started_ms, request['at_ms']), min(ended_ms, max(end.get('at_ms', ended_ms), next_start))))
    merged = []
    for left, right in sorted(intervals):
        if merged and left <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], right)
        else:
            merged.append([left, max(left, right)])
    excluded = sum(right-left for left, right in merged)
    last = max(requests)
    return {'schema': 1, 'usage': usage, 'accounting': {'source': 'unmodified-provider-responses',
        'failed_requests_excluded': len(failed), 'request_count_including_failed': len(requests),
        'reasoning_tokens_are_output_subset': True, 'cache_tokens_are_input_subset': True,
        'unknown_usage_requests': sum(key not in terminals and responses.get(key,{}).get('status') == 200 for key in requests)},
        'timing': {'policy': 'final-scored-attempt-minus-failed-requests-and-retry-waits/v1',
            'model_wall_ms': ended_ms-started_ms, 'excluded_retry_ms': excluded,
            'response_ms': max(0, ended_ms-started_ms-excluded)},
        'wire_identity': {'model':'glm-5.3-flash','reasoning_effort':'max','verified':True},
        'last_request_failed': last not in {r['sequence'] for r in valid}}
