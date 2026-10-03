import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

export function runAction(
  key: string,
  id: number,
  action: string,
  updates: Record<string, string> = {},
): ActionResult {
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
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 状态机只许沿 statuses 逐级向前：回退、越级都拒收，流转一次到位、不走回头路。
  const currentIndex = meta.statuses.indexOf(current)
  const targetIndex = meta.statuses.indexOf(target)
  if (currentIndex < 0 || targetIndex < 0) {
    return { ok: false, message: `${meta.entity}当前状态「${current}」未登记，不能流转` }
  }
  if (currentIndex === meta.statuses.length - 1) {
    return { ok: false, message: `${meta.entity}已到终态「${current}」，不能再流转` }
  }
  if (targetIndex < currentIndex) {
    return { ok: false, message: `${meta.entity}不能从「${current}」回退到「${target}」，流转只许逐级向前` }
  }
  if (targetIndex > currentIndex + 1) {
    return {
      ok: false,
      message: `${meta.entity}不能从「${current}」越级到「${target}」，请按 ${meta.statuses.join('→')} 逐级推进`,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  // 随流转一起落库的字段只认模块登记过的，状态与字段在同一次写入里更新，不留半成品。
  const carried = Object.fromEntries(
    Object.entries(updates).filter(([field]) => meta.fields.includes(field)),
  )
  const updated: EntryRow = {
    ...rows[index],
    ...carried,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 单条读取：巡线详情、补录单都从这里取同一份，页面不各自缓存、不各算各的。
export function getEntry(key: string, id: number): EntryRow | null {
  moduleMeta(key)
  return listRows(key).find((row) => Number(row.id) === id) ?? null
}

// 补录单入口：只补模块登记过的字段，不动状态。
export function updateEntryFields(
  key: string,
  id: number,
  updates: Record<string, string>,
): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const carried = Object.fromEntries(
    Object.entries(updates).filter(([field]) => meta.fields.includes(field)),
  )
  if (Object.keys(carried).length === 0) {
    return { ok: false, message: `${meta.entity}没有可补录的字段` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], ...carried }
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}补录已保存` }
}

// 二次管网巡线上报单携带的内容。
export type PatrolReport = {
  巡线周期: string
  阀门井编号: string
  投运日期: string
  巡线人: string
  巡线日期: string
  发现问题数: string
  整改期限: string
}

// 二次管网巡线上报：状态与巡线周期、阀门井编号、投运日期一次流转到位；
// 重复提交被状态机拒收、只生效一次；发现的问题落到站点巡检的待整改台账。
export function submitPatrolReport(id: number, report: PatrolReport): ActionResult {
  const segment = getEntry('secondarynet', id)
  if (!segment) {
    return { ok: false, message: `没有找到编号为 ${id} 的二次管网管段` }
  }
  const result = runAction('secondarynet', id, '完成巡线', {
    巡线周期: report.巡线周期,
    阀门井编号: report.阀门井编号,
    投运日期: report.投运日期,
  })
  if (!result.ok) {
    return { ok: false, message: `巡线上报未生效：${result.message}` }
  }
  if (Number(report.发现问题数) > 0) {
    return { ok: true, message: `${result.message}，${recordPatrolLedger(segment, report)}` }
  }
  return { ok: true, message: `${result.message}，未发现问题` }
}

// 巡线结果落到站点巡检待整改台账：同一段管段、同一个巡线周期只记一笔，重复上报不出重复记录。
function recordPatrolLedger(segment: EntryRow, report: PatrolReport): string {
  const key = 'stationpatrol'
  const rows = listRows(key)
  const route = `${segment['管段编号']}（${report.巡线周期}）`
  if (rows.some((row) => row['巡检路线'] === route)) {
    return '待整改台账已有该管段本周期记录，未重复登记'
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const nextCode = rows.reduce((max, row) => {
    const matched = /^STAT-(\d+)$/.exec(String(row['巡检编号'] ?? ''))
    return matched ? Math.max(max, Number(matched[1])) : max
  }, 0) + 1
  const entry: EntryRow = {
    id: nextId,
    status: '待巡检',
    pending: true,
    abnormal: false,
    巡检编号: `STAT-${String(nextCode).padStart(4, '0')}`,
    巡检站点: String(segment['所属片区'] ?? ''),
    巡检路线: route,
    巡检人: report.巡线人,
    巡检日期: report.巡线日期,
    发现问题数: report.发现问题数,
    整改期限: report.整改期限,
    巡检状态: '待整改',
  }
  saveRows(key, [...rows, entry])
  return `发现的 ${report.发现问题数} 个问题已记入站点巡检待整改台账`
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
