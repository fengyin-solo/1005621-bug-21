/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  /** 动作的前置状态：登记了的动作只允许从该状态发起，越级或回退一律拒收。 */
  actionSources?: Record<string, string>
  metrics: string[]
}

/** 巡线上报：页面把当班人、现场确认的阀门井编号与投运日期一起带上来。 */
export type PatrolReport = {
  operator: string
  阀门井编号?: string
  投运日期?: string
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
