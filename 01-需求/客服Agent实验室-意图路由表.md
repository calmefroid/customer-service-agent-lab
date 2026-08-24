# 客服 Agent 实验室－意图路由表

版本：V1.1  
范围：消费者端售后客服助理  
用户可见一级入口：订单物流、退换与破损、故障报修  
参考输入：《基于客服问题库的意图划分》与现有 Agent 业务流程

## 一、融合原则

客服问题库中的分类主要描述“用户在问什么知识”，适合知识维护、RAG 检索标签和标准话术；Agent 业务路由主要描述“用户想完成什么任务、系统下一步做什么”，适合查询、申请、催办、建单和转人工。两者不合并成一层，而采用以下四个维度：

| 维度 | 含义 | 示例 |
| --- | --- | --- |
| `module` | 当前业务模块或对话范围 | `repair` |
| `intent` | 用户当前目标 | `troubleshoot` |
| `topic` | 知识库检索或问题分析标签 | `smart_setup.setup_failure` |
| `action` | Agent 下一步允许执行的动作 | `retrieve_kb_then_diagnose` |

消费者首页仍只展示三个售后入口。产品知识、配网、安装指导和部分消费者业务咨询通过后台隐藏的 `knowledge_query` 路由承接，不增加第四个快捷入口。加盟、供应商、营销活动等非消费者售后问题只提供对应渠道指引，不进入业务操作流程。

图片是输入模态，不是业务意图。图片观察结果记录在 `observations`，再与用户文字、当前模块和会话状态共同判断意图；图片不得自动完成破损判责、退换资格认定或赔偿决策。

## 二、路由优先级

| 优先级 | 路由 | 处理规则 |
| --- | --- | --- |
| 1 | 确定性动作 | 按钮、表单确认和已验证页面状态直接进入动作路由，不再让模型猜测 |
| 2 | `human_escalation.safety` | 冒烟、烧焦味、触电、火花、明显过热等先提示断电和停止使用，再高优转人工 |
| 3 | `human_escalation.requested/dispute` | 用户明确要求人工，或涉及赔偿、判责、资格争议、强投诉和连续失败时转人工 |
| 4 | 写操作目标 | 退换、催办、工单等先补齐信息并生成可编辑草稿，用户确认后才能提交 |
| 5 | 查询与知识咨询 | 结构化事实走业务工具；FAQ、说明书、政策和指导走 RAG |
| 6 | `smalltalk` | 仅处理纯问候、感谢和结束语，不调用业务系统 |
| 7 | `clarification` | 可以判断大致范围但缺少关键目标、对象或现象时，只追问最关键问题 |
| 8 | `other` | 无法归类或明确超出服务范围时提供边界说明或渠道指引 |

同一句话包含多个任务时，按上述优先级处理，并把尚未处理的目标写入 `remainingIntents`。安全升级不会因为用户同时要求报修而延后。

## 三、用户自然语言业务路由

| 路由类型 | 说明 | 示例 |
| --- | --- | --- |
| `smalltalk` | 问候、感谢、结束语等纯日常对话 | “你好”“谢谢”“再见” |
| `logistics_query.status` | 查询订单、发货状态、承运商、运单号、预计送达和物流轨迹 | “我的订单到哪了”“为什么还没发货” |
| `logistics_query.contact` | 查询物流客服电话或联系承运商；先取得当前订单和承运商 | “物流电话是多少”“我要联系快递公司” |
| `logistics_query.urge` | 用户认为物流较慢，希望创建催办 | “物流太慢了，帮我催一下” |
| `return_exchange.intake` | 表达退货、换货、到货破损、少件、错发或配件补发诉求，并采集必要信息 | “灯罩碎了”“少发一个配件”“型号发错了” |
| `return_exchange.create` | 生成可编辑退换申请草稿，确认后创建申请 | “我要换货”“确认提交退货申请” |
| `return_exchange.status` | 查询退换申请的审核、取件、收货或处理进度 | “我的换货申请到哪一步了” |
| `repair_support.troubleshoot` | 普通故障的安全分级、知识检索和不拆机排查 | “客厅灯一直闪”“遥控器没反应” |
| `repair_support.smart_setup` | WIFI、设备绑定、语音控制和第三方音箱相关设置或故障 | “为什么搜不到设备”“怎么绑定小爱音箱” |
| `repair_support.policy` | 报修流程、保修规则、收费、配件、换新和特殊售后政策 | “保修几年”“过保维修怎么收费” |
| `repair_support.installation_guide` | 安装视频、非危险使用说明和拆卸指引；危险接线操作不由模型生成 | “安装视频在哪里”“怎么取下灯罩清洁” |
| `service_ticket.create` | 普通排查未解决、需要上门维修或预约安装服务，生成可编辑工单 | “还是没恢复，帮我报修”“预约师傅安装” |
| `service_ticket.query` | 查询报修、安装服务或其他售后工单进度 | “师傅什么时候联系我”“安装预约到哪了” |
| `knowledge_query.product` | 产品型号、系列、功能、使用方式、参数和产品认证查询 | “浴霸是单电机还是双电机”“这款支持 WIFI 吗” |
| `knowledge_query.consumer_business` | 面向消费者的门店、购买渠道、验真、企业资质和客服电话查询 | “附近门店在哪里”“怎么验证产品真伪” |
| `human_escalation.safety` | 安全信号中断普通流程并升级安全专席 | “有烧焦味”“开关冒火花”“灯开始冒烟” |
| `human_escalation.requested` | 用户明确要求人工客服 | “转人工”“让客服处理” |
| `human_escalation.dispute` | 赔偿、责任认定、资格争议、强投诉或持续处理失败 | “必须赔偿我”“我要投诉” |
| `clarification` | 可确认大致范围，但缺少用户目标、商品、订单或故障现象 | “这个怎么处理”“还是不行” |
| `other` | 完全无法归类，或加盟、供应商、市场活动等非消费者售后问题 | “我要申请成为供应商”“代理加盟找谁” |

`knowledge_query` 是后台隐藏路由。它可以主动响应用户输入，但不会出现在首页快捷入口，也不能直接执行退换、催办、建单等写操作。

## 四、客服问题库主题与业务路由映射

| 原一级主题 | 原二级主题 | 融合后的 `topic` | 默认业务路由或边界 |
| --- | --- | --- | --- |
| 寒暄问候 | 日常寒暄 | `conversation.greeting` | `smalltalk` |
| 产品知识 | 产品介绍与型号 | `product.model_overview` | `knowledge_query.product`；质保问题优先归入售后政策 |
| 产品知识 | 产品功能与使用 | `product.function_usage` | `knowledge_query.product`；配网和故障问题转故障报修 |
| 产品知识 | 产品参数 | `product.specification` | 结构化参数优先查询 PCMP，说明文字可使用 RAG |
| 产品知识 | 品牌标识与认证 | `product.certification` | `knowledge_query.product` |
| 故障排查 | 灯具不亮/光源故障 | `fault.not_lit` | `repair_support.troubleshoot` |
| 故障排查 | 频闪/自动变光 | `fault.flicker_color_change` | `repair_support.troubleshoot` |
| 故障排查 | 异响/异味 | `fault.noise_odor` | 先做安全检测；烧焦味等转 `human_escalation.safety` |
| 故障排查 | 遥控器/开关失灵 | `fault.remote_switch` | `repair_support.troubleshoot` |
| 故障排查 | 其他故障 | `fault.other` | 先区分到货破损、使用中故障和安全风险 |
| 售后报修 | 报修流程与入口 | `after_sales.repair_process` | 咨询走 `repair_support.policy`；实际报修走 `service_ticket.create` |
| 售后报修 | 保修政策与质保 | `after_sales.warranty` | `repair_support.policy` |
| 售后报修 | 收费标准与报价 | `after_sales.fee` | 只回答已发布标准；个案报价和争议转人工 |
| 售后报修 | 配件购买 | `after_sales.parts` | 收货缺件进入退换；使用后购买配件进入政策咨询或人工渠道 |
| 售后报修 | 换新服务 | `after_sales.replacement` | 规则咨询走 RAG；申请换新进入 `return_exchange.create` |
| 售后报修 | 非联保/特殊售后 | `after_sales.special_case` | 规则咨询走 RAG；例外审批和争议转人工 |
| 配网智控 | WIFI 连接方法 | `smart_setup.wifi_connect` | `repair_support.smart_setup` |
| 配网智控 | 配网失败排查 | `smart_setup.setup_failure` | `repair_support.smart_setup` |
| 配网智控 | 语音控制 | `smart_setup.voice_control` | `repair_support.smart_setup` |
| 配网智控 | 第三方音箱绑定 | `smart_setup.third_party_speaker` | `repair_support.smart_setup` |
| 安装服务 | 安装视频指引 | `installation.video_guide` | `repair_support.installation_guide` |
| 安装服务 | 接线方法 | `installation.wiring` | 仅引用经审核的安全说明；涉及带电、拆线或裸线操作时停止指导并转人工 |
| 安装服务 | 产品拆卸 | `installation.disassembly` | 仅提供明确允许的非危险步骤，否则转人工 |
| 安装服务 | 上门安装预约 | `installation.appointment` | `service_ticket.create`，`serviceType=installation` |
| 业务咨询 | 购买与门店查询 | `business.store_purchase` | `knowledge_query.consumer_business`，仅提供消费者渠道信息 |
| 业务咨询 | 加盟与市场活动 | `business.franchise_marketing` | `other`，提供官方业务渠道指引 |
| 业务咨询 | 电商售后 | `business.ecommerce_after_sales` | 结合诉求进入退换、故障报修或政策咨询 |
| 业务咨询 | 辨别真伪与打假 | `business.authenticity` | 提供官方验真入口；不由图片模型直接判真伪 |
| 业务咨询 | 企业信息与资质 | `business.company_credentials` | 消费者所需信息可走知识问答，其他需求提供渠道指引 |
| 业务咨询 | 供应商相关 | `business.supplier` | `other`，提供供应商官方渠道指引 |

原问题库文档表格实际列出 30 个二级主题，后续统计、训练集和评测标签统一按表格实际数量管理；其中约 109 条尚未细分的问题仍需重新标注。

## 五、易冲突表达的消歧规则

| 表达 | 判断依据 | 路由结果 |
| --- | --- | --- |
| “灯罩碎了” | 收货时已破损 | `return_exchange.intake`，`topic=return.arrival_damage` |
| “灯罩用了半年裂了” | 使用后发生 | `repair_support.troubleshoot` 或配件售后 |
| “这款质保多久” | 只咨询规则 | `repair_support.policy`，`topic=after_sales.warranty` |
| “还在质保期，帮我报修” | 明确要求执行 | `service_ticket.create` |
| “灯有嗡嗡声” | 未出现安全信号 | `repair_support.troubleshoot`，`topic=fault.noise_odor` |
| “灯有烧焦味” | 命中安全信号 | `human_escalation.safety` |
| “网购的灯怎么售后” | 泛化规则咨询 | `repair_support.policy`，`topic=business.ecommerce_after_sales` |
| “网购这单我要退货” | 针对订单执行退货 | `return_exchange.create` |
| “帮我看图确认能不能退” | 图片只能提供观察 | 图片观察 → 资格预校验；最终资格争议转人工 |

## 六、确定性动作路由

以下路由由按钮、表单确认或已验证页面状态触发，不应再次交给模型猜测意图。

| 路由类型 | 说明 |
| --- | --- |
| `confirm_identity` | 确认使用当前账号查询订单、物流、退换或工单 |
| `prepare_logistics_urge` | 读取当前物流并生成催办确认摘要，不执行写操作 |
| `submit_logistics_urge` | 用户确认后创建 TMS 催办并同步 CRM |
| `prepare_return` | 汇总问题与图片观察，生成可编辑退换申请草稿 |
| `submit_return` | 读取用户最终编辑字段并创建退换申请 |
| `prepare_service_ticket` | 汇总故障、排查结果或安装需求，生成可编辑工单 |
| `submit_service_ticket` | 用户确认后创建维修或安装服务工单 |
| `cancel_operation` | 取消当前写操作，不提交任何申请或工单 |

## 七、结构化意图输出

```json
{
  "module": "repair",
  "intent": "troubleshoot",
  "topic": "smart_setup.setup_failure",
  "action": "retrieve_kb_then_diagnose",
  "riskLevel": "none",
  "confidence": 0.96,
  "needsClarification": false,
  "requiresConfirmation": false,
  "requiresHuman": false,
  "remainingIntents": [],
  "entities": {
    "productId": null,
    "orderId": null,
    "serviceType": null
  },
  "observations": []
}
```

消费者端只看到适合等待反馈的精简执行进度。Mock 后台 Trace 记录应用定义的完整 Prompt、模型输入输出、候选分类、规则命中证据、实体、完整路由结果、知识条目、来源版本和脱敏工具参数；平台级隐藏指令与模型私有思维链不属于应用可观测数据。

## 八、当前实现差异

当前代码仍以 `logistics_query`、`return_exchange`、`troubleshooting`、`service_ticket_create`、`service_ticket_query`、`human_escalation`、`smalltalk`、`other` 八类一级意图为主。后续实现需补齐：

- `module + intent + topic + action` 的结构化输出。
- 隐藏的 `knowledge_query` 路由及其 RAG 标签过滤。
- 退换进度、主动转人工、争议升级和 `clarification`。
- 配网、售后政策、安装指导与安装服务工单。
- 产品知识、消费者业务咨询和非消费者业务渠道指引。
- 混合意图、消歧规则以及对应固定评测案例。
