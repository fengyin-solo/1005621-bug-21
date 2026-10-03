import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult, PatrolReport } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 二次管网巡线口径：巡线周期按「YYYY-MM期」逐月推进，完成巡线时一次流转到位；
// 巡线结果落到站点巡检的待整改台账，同一管段同一巡线周期只落一条，重复上报不再生效。
const PATROL_MODULE = 'secondarynet'
const PATROL_ACTION = '完成巡线'
const PATROL_LEDGER_MODULE = 'stationpatrol'
const RECTIFY_DEADLINE_DAYS = 7

export function patrolCycleLabel(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${month}期`
}

function dateLabel(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function nextNumericId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string, payload?: PatrolReport): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    if (key === PATROL_MODULE && action === PATROL_ACTION) {
      return { ok: false, message: `${meta.entity}本轮巡线上报已生效，重复提交只生效一次` }
    }
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const source = meta.actionSources?.[action]
  if (source && current !== source) {
    return {
      ok: false,
      message: `${meta.entity}当前状态「${current}」不能执行「${action}」，状态须按${meta.statuses.join('→')}依次推进，越级拒收`,
    }
  }
  if (key === PATROL_MODULE && action === PATROL_ACTION) {
    return completeSecondaryPatrol(rows, index, payload ?? { operator: '值班管理员' })
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 完成巡线一次流转到位：状态、巡线周期、阀门井编号、投运日期同一次写入，
// 同时把巡线结果落到站点巡检的待整改台账；台账按「管段编号+巡线周期」去重，重复上报只生效一次。
function completeSecondaryPatrol(rows: EntryRow[], index: number, report: PatrolReport): ActionResult {
  const row = rows[index]
  const cycle = patrolCycleLabel()
  const valveWell = String(report.阀门井编号 ?? row['阀门井编号'] ?? '').trim()
  const commissionDate = String(report.投运日期 ?? row['投运日期'] ?? '').trim()
  if (!commissionDate) {
    return { ok: false, message: '投运日期仍空缺，请先在补录单补齐投运日期，再完成巡线' }
  }
  const updated: EntryRow = {
    ...row,
    status: '运行正常',
    pending: true,
    abnormal: false,
    巡线周期: cycle,
    阀门井编号: valveWell,
    投运日期: commissionDate,
  }
  const next = [...rows]
  next[index] = updated

  const ledgerRows = listRows(PATROL_LEDGER_MODULE)
  const ledgerCode = `XJ-${String(row['管段编号'])}-${cycle}`
  let ledgerMessage = '，巡线结果已记入站点巡检待整改台账'
  if (ledgerRows.some((item) => String(item['巡检编号']) === ledgerCode)) {
    ledgerMessage = '，待整改台账已有本轮巡线记录，未重复登记'
  } else {
    const deadline = new Date()
    deadline.setDate(deadline.getDate() + RECTIFY_DEADLINE_DAYS)
    saveRows(PATROL_LEDGER_MODULE, [
      ...ledgerRows,
      {
        id: nextNumericId(ledgerRows),
        status: '巡检中',
        pending: true,
        abnormal: false,
        巡检编号: ledgerCode,
        巡检站点: String(row['所属片区'] ?? ''),
        巡检路线: `二次管网巡线 ${String(row['管段编号'])}`,
        巡检人: report.operator,
        巡检日期: dateLabel(new Date()),
        发现问题数: 0,
        整改期限: dateLabel(deadline),
        巡检状态: '待整改',
      },
    ])
  }
  saveRows(PATROL_MODULE, next)
  return {
    ok: true,
    message: `二次管网管段已完成巡线，状态推进到「运行正常」，巡线周期更新为「${cycle}」${ledgerMessage}`,
  }
}

// 补录单：只补登记字段（如投运日期），不触碰状态流转；巡线周期仍读管段上那一份。
export function supplementEntry(key: string, id: number, patch: Record<string, string>): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const commissionDate = String(patch['投运日期'] ?? '').trim()
  if (!commissionDate) {
    return { ok: false, message: '补录单需要填写投运日期' }
  }
  const next = [...rows]
  next[index] = { ...rows[index], 投运日期: commissionDate }
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}补录完成，投运日期已登记为 ${commissionDate}` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
