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

    <!-- 投运日期空缺的管段先单列一栏，从这里进补录单 -->
    <section v-if="missingCommission.length" class="ledger-panel">
      <h3>投运日期空缺待补录（{{ missingCommission.length }}）</h3>
      <ul class="ledger-list">
        <li v-for="row in missingCommission" :key="`missing-${row.id}`">
          <span>{{ row['管段编号'] }}</span>
          <span>{{ row['所属片区'] }}</span>
          <span>巡线周期：{{ row['巡线周期'] || '—' }}</span>
          <span>当前状态：{{ row.status }}</span>
          <button class="link" type="button" @click="openSupplement(row)">补录投运日期</button>
        </li>
      </ul>
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
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="action === '完成巡线' ? openPatrolReport(row) : runAction(action, row)"
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
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 巡线详情：打开时从数据层取同一份记录，看到的就是当前状态 -->
    <div v-if="detailRow" class="modal-mask" @click.self="detailRow = null">
      <div class="modal-card">
        <h3>巡线详情 · {{ detailRow['管段编号'] }}</h3>
        <dl class="detail-grid">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ detailRow[column] ?? '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
        </dl>
        <div class="modal-actions">
          <button class="btn" type="button" @click="detailRow = null">关闭</button>
        </div>
      </div>
    </div>

    <!-- 巡线上报单：确认后状态与巡线周期、阀门井编号、投运日期一次流转到位 -->
    <div v-if="reportOpen" class="modal-mask" @click.self="closeReport">
      <div class="modal-card">
        <h3>巡线上报单 · {{ reportForm.管段编号 }}</h3>
        <form class="form-grid" @submit.prevent="submitReport">
          <label>
            <span>巡线周期</span>
            <input v-model="reportForm.巡线周期" required />
          </label>
          <label>
            <span>阀门井编号</span>
            <input v-model="reportForm.阀门井编号" required />
          </label>
          <label>
            <span>投运日期</span>
            <input v-model="reportForm.投运日期" type="date" />
          </label>
          <label>
            <span>巡线人</span>
            <input v-model="reportForm.巡线人" required />
          </label>
          <label>
            <span>巡线日期</span>
            <input v-model="reportForm.巡线日期" type="date" required />
          </label>
          <label>
            <span>发现问题数</span>
            <input v-model="reportForm.发现问题数" type="number" min="0" />
          </label>
          <label>
            <span>整改期限</span>
            <input v-model="reportForm.整改期限" type="date" />
          </label>
          <p v-if="reportError" class="error-text">{{ reportError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeReport">取消</button>
            <button class="btn primary" type="submit" :disabled="reportSubmitting">提交巡线上报</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 投运日期补录单：巡线周期与巡线详情读的是同一份，这里只补投运日期 -->
    <div v-if="supplementOpen" class="modal-mask" @click.self="supplementOpen = false">
      <div class="modal-card">
        <h3>投运日期补录单 · {{ supplementForm.管段编号 }}</h3>
        <dl class="detail-grid">
          <dt>巡线周期</dt>
          <dd>{{ supplementForm.巡线周期 || '—' }}</dd>
        </dl>
        <form class="form-grid" @submit.prevent="submitSupplement">
          <label>
            <span>投运日期</span>
            <input v-model="supplementForm.投运日期" type="date" required />
          </label>
          <p v-if="supplementError" class="error-text">{{ supplementError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="supplementOpen = false">取消</button>
            <button class="btn primary" type="submit">保存补录</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  submitPatrolReport,
  updateEntryFields,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('secondarynet')
const columns = ["管段编号", "所属片区", "公称管径", "敷设方式", "阀门井编号", "巡线周期", "投运日期", "管段状态"]
const actions = ["完成巡线", "安排检修", "报废管段"]
const statuses = ["待巡线", "运行正常", "待检修", "已废弃"]
const stats = [{"label": "运行正常管段", "value": 0}, {"label": "待检修管段", "value": 0}, {"label": "待巡线管段", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const missingCommission = ref<EntryRow[]>([])
const detailRow = ref<EntryRow | null>(null)
const reportOpen = ref(false)
const reportSubmitting = ref(false)
const reportError = ref('')
const reportForm = ref({
  id: 0,
  管段编号: '',
  巡线周期: '',
  阀门井编号: '',
  投运日期: '',
  巡线人: '',
  巡线日期: '',
  发现问题数: '0',
  整改期限: '',
})
const supplementOpen = ref(false)
const supplementError = ref('')
const supplementForm = ref({ id: 0, 管段编号: '', 巡线周期: '', 投运日期: '' })
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

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

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

// 详情直接读数据层同一份记录，巡线完成后看到的就是新状态，不会退回待巡线。
function openDetail(row: EntryRow) {
  const fresh = getEntry(meta.key, Number(row.id))
  if (!fresh) {
    errorMessage.value = '该管段已不存在，请刷新列表'
    return
  }
  detailRow.value = fresh
}

// 完成巡线走巡线上报单：表单先按数据层当前记录预填，提交时一次流转到位。
function openPatrolReport(row: EntryRow) {
  const fresh = getEntry(meta.key, Number(row.id))
  if (!fresh) {
    errorMessage.value = '该管段已不存在，请刷新列表'
    return
  }
  reportForm.value = {
    id: Number(fresh.id),
    管段编号: String(fresh['管段编号'] ?? ''),
    巡线周期: String(fresh['巡线周期'] ?? ''),
    阀门井编号: String(fresh['阀门井编号'] ?? ''),
    投运日期: String(fresh['投运日期'] ?? ''),
    巡线人: '',
    巡线日期: new Date().toISOString().slice(0, 10),
    发现问题数: '0',
    整改期限: '',
  }
  reportError.value = ''
  reportOpen.value = true
}

function closeReport() {
  reportOpen.value = false
}

// 连点只提交一次；服务端状态机同样拒收重复上报。
function submitReport() {
  if (reportSubmitting.value) {
    return
  }
  reportSubmitting.value = true
  reportError.value = ''
  try {
    const result = submitPatrolReport(reportForm.value.id, {
      巡线周期: reportForm.value.巡线周期.trim(),
      阀门井编号: reportForm.value.阀门井编号.trim(),
      投运日期: reportForm.value.投运日期,
      巡线人: reportForm.value.巡线人.trim(),
      巡线日期: reportForm.value.巡线日期,
      发现问题数: reportForm.value.发现问题数,
      整改期限: reportForm.value.整改期限,
    })
    if (!result.ok) {
      reportError.value = result.message
      return
    }
    reportOpen.value = false
    reload()
  } finally {
    reportSubmitting.value = false
  }
}

// 补录单与巡线详情读同一份记录，巡线周期两处一致，沿用既有巡线口径。
function openSupplement(row: EntryRow) {
  const fresh = getEntry(meta.key, Number(row.id))
  if (!fresh) {
    errorMessage.value = '该管段已不存在，请刷新列表'
    return
  }
  supplementForm.value = {
    id: Number(fresh.id),
    管段编号: String(fresh['管段编号'] ?? ''),
    巡线周期: String(fresh['巡线周期'] ?? ''),
    投运日期: String(fresh['投运日期'] ?? ''),
  }
  supplementError.value = ''
  supplementOpen.value = true
}

function submitSupplement() {
  supplementError.value = ''
  const result = updateEntryFields(meta.key, supplementForm.value.id, {
    投运日期: supplementForm.value.投运日期,
  })
  if (!result.ok) {
    supplementError.value = result.message
    return
  }
  supplementOpen.value = false
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 空缺栏不受筛选条件影响，始终单列在前面。
    missingCommission.value = listEntries(meta.key).items.filter(
      (row) => String(row['投运日期'] ?? '').trim() === '',
    )
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '二次管网列表读取失败'
  }
}

onMounted(reload)
</script>
