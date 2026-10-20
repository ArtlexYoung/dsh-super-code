import json
from pathlib import Path
import tempfile
import unittest
from wire_metrics import calculate


class TransportMetrics(unittest.TestCase):
    def test_outage_intervals_merge_without_refunding_a_successful_request(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);wire=root/'wire.jsonl';outages=root/'outages.json'
            rows=[{'event':'request','sequence':1,'at_ms':100,'model':'glm-5.3-flash','reasoning_effort':'max'},
                {'event':'request-error','sequence':1,'at_ms':200},
                {'event':'request','sequence':2,'at_ms':500,'model':'glm-5.3-flash','reasoning_effort':'max'},
                {'event':'finished','sequence':2,'at_ms':800,'model':'glm-5.3-flash','type':'response.completed',
                 'usage':{'input_tokens':100,'output_tokens':20,'total_tokens':120}}]
            wire.write_text(''.join(json.dumps(r)+'\n' for r in rows))
            outages.write_text(json.dumps({'intervals':[{'started_at_ms':100,'finished_at_ms':500},{'started_at_ms':850}]}))
            result=calculate(wire,0,1000,outages_path=outages)
            self.assertEqual(result['usage']['model_calls'],1)
            self.assertEqual(result['usage']['total_tokens'],120)
            self.assertEqual(result['timing']['excluded_retry_ms'],550)
            self.assertEqual(result['timing']['response_ms'],450)
            self.assertFalse(result['last_request_failed'])


if __name__=='__main__':unittest.main()
