/** Package switches around the host's native parser, ranking and resource loader. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "super-code-bundled-skills";
export declare const inject: string[];
export interface Config {
    readonly bundledSkillDir: string;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=bundled-skills.d.ts.map