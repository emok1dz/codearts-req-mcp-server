# 真实调用记录（2026-11-06T01:48Z，区域 cn-east-3 华东-上海一，npm run smoke -- --create TestDemo）
```
[codearts-req] MCP Server v1.0.0 已启动（stdio），等待客户端连接…
✔ 已连接 codearts-req，工具 2 个：
  - create_project: 在华为云 CodeArts 需求管理（CodeArts Req）中创建一个新项目（API: CreateProjectV4，POST /v4/project）。
  - list_projects: 分页查询华为云 CodeArts 需求管理（CodeArts Req）中当前用户可见的项目列表（API: ListProjectsV4，GET /v4/projects）。
[codearts-req] list_projects OK 2014ms

✔ list_projects {limit: 5}
没有查询到项目。

{
  "total": 0,
  "offset": 0,
  "limit": 5,
  "returned": 0,
  "has_more": false,
  "projects": []
}
[codearts-req] list_projects ERROR INVALID_ARGUMENTS 1ms

✘ 参数校验示例 list_projects {offset: 3, limit: 10}
【INVALID_ARGUMENTS】参数校验失败：offset 必须是 limit 的整数倍（offset=3, limit=10），例如 0

{
  "error": {
    "code": "INVALID_ARGUMENTS",
    "message": "参数校验失败：offset 必须是 limit 的整数倍（offset=3, limit=10），例如 0",
    "errors": [
      "offset 必须是 limit 的整数倍（offset=3, limit=10），例如 0"
    ]
  }
}
[codearts-req] create_project OK 1382ms

✔ create_project {project_name: TestDemo, project_type: scrum}
项目「TestDemo」创建成功，project_id = d9b02289185448db8ceec7115f15327b（类型 scrum）。

{
  "project_id": "d9b02289185448db8ceec7115f15327b",
  "project_num_id": 715155718,
  "project_name": "TestDemo",
  "project_type": "scrum",
  "description": "created by codearts-req MCP smoke test",
  "user_num_id": 700697836
}
```

## 复核：再次查询项目列表
```
✔ list_projects {limit: 5}
共 1 个项目，本页返回第 1~1 个：TestDemo。

{
  "total": 1,
  "offset": 0,
  "limit": 5,
  "returned": 1,
  "has_more": false,
  "projects": [
    {
      "project_id": "d9b02289185448db8ceec7115f15327b",
      "project_num_id": 715155718,
      "project_name": "TestDemo",
      "description": "created by codearts-req MCP smoke test",
      "project_type": "scrum",
      "created_time": "2026-11-06 01:48:25 UTC",
      "updated_time": "2026-11-06 01:48:25 UTC",
      "creator": {
        "user_name": "hid_wk_461e2jr6dis3",
        "user_num_id": 700697836
      }
    }
  ]
}
```
