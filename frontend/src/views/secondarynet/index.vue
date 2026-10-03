<template>
  <section class="page" data-module="secondarynet">
    <header class="page-head">
      <div>
        <h2>二次管网管理</h2>
        <p class="page-desc">维护二次管网管段，围绕管段编号、所属片区、公称管径、敷设方式做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记二次管网管段</button>
        <button class="btn" type="button" @click="exportRows">导出二次管网清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section v-if="missingCommission.length" class="panel" data-panel="missing-commission">
      <h3 class="panel-title">投运日期空缺管段（{{ missingCommission.length }}）——先在补录单补齐投运日期，再完成巡线</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>管段编号</th>
            <th>所属片区</th>
            <th>巡线周期</th>
            <th>投运日期</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in missingCommission" :key="`missing-${String(row.id)}`">
            <td>{{ row['管段编号'] }}</td>
            <td>{{ row['所属片区'] }}</td>
            <td>{{ row['巡线周期'] }}</td>
            <td>—</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openSupplement(row)">补录投运日期</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">巡线详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无二次管网数据，可先登记二次管网管段</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条二次管网记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card" data-panel="patrol-detail">
        <h3>巡线详情 · {{ detailRow['管段编号'] }}</h3>
        <dl class="detail-grid">
          <div v-for="field in detailFields" :key="field" class="detail-item">
            <dt>{{ field }}</dt>
            <dd>{{ detailRow[field] || '—' }}</dd>
          </div>
          <div class="detail-item">
            <dt>当前状态</dt>
            <dd>{{ detailRow.status }}</dd>
          </div>
        </dl>
        <template v-if="detailRow.status === '待巡线'">
          <label class="form-item">
            <span>阀门井编号（巡线确认）</span>
            <input v-model="reportForm.阀门井编号" placeholder="现场确认的阀门井编号" />
          </label>
          <label class="form-item">
            <span>投运日期（巡线确认）</span>
            <input v-model="reportForm.投运日期" type="date" />
          </label>
          <p class="modal-hint">提交巡线上报后：状态推进到「运行正常」，巡线周期进入「{{ nextCycle }}」，结果记入站点巡检待整改台账。</p>
        </template>
        <p v-else class="modal-hint">该管段本轮巡线已流转，详情只读，不会退回待巡线。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
          <button
            v-if="detailRow.status === '待巡线'"
            class="btn primary"
            type="button"
            @click="submitReport"
          >
            提交巡线上报
          </button>
        </div>
      </div>
    </div>

    <div v-if="supplementRow" class="modal-mask" @click.self="closeSupplement">
      <div class="modal-card" data-panel="patrol-supplement">
        <h3>补录单 · {{ supplementRow['管段编号'] }}</h3>
        <dl class="detail-grid">
          <div class="detail-item">
            <dt>巡线周期</dt>
            <dd>{{ supplementRow['巡线周期'] || '—' }}</dd>
          </div>
          <div class="detail-item">
            <dt>当前状态</dt>
            <dd>{{ supplementRow.status }}</dd>
          </div>
        </dl>
        <label class="form-item">
          <span>投运日期（补录）</span>
          <input v-model="supplementDate" type="date" />
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeSupplement">取消</button>
          <button class="btn primary" type="button" @click="submitSupplement">提交补录</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  patrolCycleLabel,
  runAction as applyAction,
  supplementEntry,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('secondarynet')
const session = useSessionStore()
const columns = ["管段编号", "所属片区", "公称管径", "敷设方式", "阀门井编号", "巡线周期", "投运日期", "管段状态"]
const actions = ["完成巡线", "安排检修", "报废管段"]
const statuses = ["待巡线", "运行正常", "待检修", "已废弃"]
const detailFields = ["管段编号", "所属片区", "公称管径", "敷设方式", "巡线周期"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const missingCommission = ref<EntryRow[]>([])
const detailRow = ref<EntryRow | null>(null)
const reportForm = ref({ 阀门井编号: '', 投运日期: '' })
const supplementRow = ref<EntryRow | null>(null)
const supplementDate = ref('')
const nextCycle = patrolCycleLabel()

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '运行正常管段', value: countStatus('运行正常') },
  { label: '待检修管段', value: countStatus('待检修') },
  { label: '待巡线管段', value: countStatus('待巡线') },
])

function countStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function isMissingCommission(row: EntryRow): boolean {
  return String(row['投运日期'] ?? '').trim() === ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '二次管网管段登记入口尚未接入审批流'
}

function openDetail(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  detailRow.value = row
  reportForm.value = {
    阀门井编号: String(row['阀门井编号'] ?? ''),
    投运日期: String(row['投运日期'] ?? ''),
  }
}

function closeDetail() {
  detailRow.value = null
}

function submitReport() {
  if (!detailRow.value) {
    return
  }
  const result = applyAction(meta.key, Number(detailRow.value.id), '完成巡线', {
    operator: session.operator,
    ...reportForm.value,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  closeDetail()
  reload()
}

function openSupplement(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  supplementRow.value = row
  supplementDate.value = String(row['投运日期'] ?? '')
}

function closeSupplement() {
  supplementRow.value = null
}

function submitSupplement() {
  if (!supplementRow.value) {
    return
  }
  const result = supplementEntry(meta.key, Number(supplementRow.value.id), {
    投运日期: supplementDate.value,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  closeSupplement()
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, { operator: session.operator })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    missingCommission.value = listEntries(meta.key).items.filter(isMissingCommission)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '二次管网列表读取失败'
  }
}

onMounted(reload)
</script>
