### Eval

**You own the experiment design. Plan, blind, run, synthesize.**

**Non-negotiables for blinding:**

- No `eval`, `test`, `judge`, `experiment`, `rubric`, `score`, `compare`, `benchmark`, `candidate`, or `arena` in any directory, file, or prompt the candidate sees.
- The candidate prompt looks like an organic user request. State the goal, not the meta.
- No chain-eliciting cues. Don't ask the candidate to list which skills, principles, or files they applied. Ask for design notes generally and grade chain-following from code shape, not self-report.
- Sanitize directory and slug names. Use project-shaped names a user might pick.
- Don't tell the candidate other candidates exist.
- The judge can know it's judging but sees outputs by sanitized label only, never by model name.
- Comparing two variants: one judge scores both sets in a single pass on one scale, blind to which set each came from.

**Steps:**

1. **Frame.** State what variant is under test and what behavior counts as success. Write the rubric (3-6 concrete criteria) for the judge only. Hold it back from candidates.
2. **Set up sanitized environments.** Per-candidate working dir with the variant in place. Plant any context an organic task would have: a project skeleton, the skills the candidate would naturally read.
3. **Author one organic prompt.** What a user would type. No leakage of what's being measured.
4. **Run N independent candidates** per the adapted arena Phase B, in isolated sanitized directories with the same organic prompt. Queue within host capacity. Use confirmed different models when available; otherwise disclose that this compares independent same-model runs, not model families.
5. **Run one blinded independent judge** per the adapted arena Phase C. Prefer a confirmed different model family; otherwise disclose the missing model diversity. It sees sanitized output labels and the rubric, never route/variant names. If independent delegation is unavailable, mark the judgment as self-review rather than claiming an independent experiment.
6. **Verify the chain from recorded tool events, not self-report.** Use public DSH session events, the caller-accessible MCP dsh_read results, or the explicit conversation export, as described in DSH.md. Check the files each candidate actually read and the resulting code shape. Keep the judge blind to model and variant names. If the host exposes no such evidence, label chain-following unverified; do not turn a candidate's claim into proof or read private journals.
7. **Read every candidate output yourself** end to end. Compare to the judge's verdict. Disagreement means a model is biased or the rubric is ambiguous. Synthesize.

**Reply:** variant under test, rubric, per-candidate notes, judge's verdict, your synthesis, and a recommendation for whether to promote the variant.
