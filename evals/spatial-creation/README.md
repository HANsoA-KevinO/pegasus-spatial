# Pegasus Spatial 行为验收定义

`behavior-cases.json` 固定五类第一阶段 Agent 行为的成本、询问和中文交付边界。它刻意允许“直接调用目标工具”与“先生成一次参考图”两种组合，不规定僵硬的执行顺序。

当前 CI 只运行 `verify-definitions.ts`，用于防止验收契约漂移；它不调用模型、网络或供应商，也不代表模型行为已经通过。比赛前必须在 H0 凭证环境中逐例重放，保存实际 tool trace、询问文本、付费提交次数和最终中文答复，再将 `model_behavior_results_available` 的事实状态记录在独立验收报告中。
