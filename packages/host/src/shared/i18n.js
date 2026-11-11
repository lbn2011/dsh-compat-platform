/**
 * i18n — bilingual glossary for machine words.
 *
 * WHAT THIS MODULE IS: Chinese glosses for all machine words (state, outcome,
 * baseline state, limitation code, issue code, conflict type, etc.). The
 * machine word is always printed beside the gloss, so a translation can never
 * be mistaken for the value itself.
 *
 * WHY BILINGUAL: the reader is the operator of this installation (Chinese), but
 * every machine word must remain in its original English form for greppability
 * and cross-reference with source code/docs.
 */

/** State words (profile, static, runtime, admission channels). */
export var STATE_WORDS = {
  provided: '已提供',
  absent: '未提供'
}

/** Outcome words (per-channel diagnostic result). */
export var OUTCOME_WORDS = {
  unknown: '未知',
  clear: '无异常',
  attention: '需注意',
  invalid: '无效',
  error: '出错'
}

/** Baseline state words (provenance per source). */
export var BASELINE_WORDS = {
  recorded: '已记录',
  'not-reflected': '未反映',
  'not-provided': '未提供',
  'not-readable': '不可读'
}

/** Tone mapping for outcomes (only these get color). */
export var OUTCOME_TONE = {
  attention: 'warn',
  invalid: 'bad',
  error: 'bad'
}

/** Next-step codes (closed set per source/outcome). */
export var NEXT_STEP_WORDS = {
  SOURCE_NOT_PROVIDED: '未提供该来源的文档',
  PROFILE_ATTENTION: 'profile 输入需注意',
  PROFILE_INVALID: 'profile 输入无效',
  PROFILE_ERROR: 'profile 输入出错',
  PROFILE_UNKNOWN: 'profile 输入结果未知',
  STATIC_ATTENTION: 'static 输入需注意',
  STATIC_INVALID: 'static 输入无效',
  STATIC_ERROR: 'static 输入出错',
  STATIC_UNKNOWN: 'static 输入结果未知',
  RUNTIME_ATTENTION: 'runtime 输入需注意',
  RUNTIME_INVALID: 'runtime 输入无效',
  RUNTIME_ERROR: 'runtime 输入出错',
  RUNTIME_UNKNOWN: 'runtime 输入结果未知',
  ADMISSION_ATTENTION: 'admission 输入需注意',
  ADMISSION_INVALID: 'admission 输入无效',
  ADMISSION_ERROR: 'admission 输入出错',
  ADMISSION_UNKNOWN: 'admission 输入结果未知'
}

/** Conflict type codes (C1-C11 taxonomy). */
export var CONFLICT_WORDS = {
  C1: '依赖缺失',
  C2: '服务/rowId 重复',
  C3: 'Slot 键冲突',
  C4: 'Waterfall 顺序',
  C5: '配置覆盖优先级',
  C6: '平台不兼容',
  C7: 'Host 版本漂移',
  C8: '清理竞态',
  C9: '命名空间污染',
  C10: '事件字符串误用',
  C11: '包结构非法'
}

/** Conflict severity words. */
export var SEVERITY_WORDS = {
  blocker: '阻断',
  high: '高',
  medium: '中',
  low: '低'
}

/** Conflict severity tone. */
export var SEVERITY_TONE = {
  blocker: 'bad',
  high: 'bad',
  medium: 'warn',
  low: 'good'
}

/** Resource kind words (for occupancy table). */
export var RESOURCE_KIND_WORDS = {
  service: '服务',
  tool: '工具',
  slot: 'Slot'
}

/** Patch action words. */
export var PATCH_ACTION_WORDS = {
  replace: '替换',
  insert: '插入',
  disable: '禁用',
  prepend: '前置'
}

/** Layer names. */
export var LAYER_WORDS = {
  profile: 'Profile 层',
  bundle: 'Bundle 层',
  home: 'Home Patch',
  'cli-patch': 'CLI Patch',
  embedded: '（内嵌）'
}

/** Approval status words. */
export var APPROVAL_STATUS_WORDS = {
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝'
}

/** Approval status tone. */
export var APPROVAL_STATUS_TONE = {
  pending: 'warn',
  approved: 'good',
  rejected: 'bad'
}

/** Fiber state words (cordis lifecycle). */
export var FIBER_STATE_WORDS = {
  PENDING: '等待依赖',
  LOADING: '加载中',
  ACTIVE: '已激活',
  FAILED: '失败',
  DISPOSED: '已销毁',
  UNLOADING: '卸载中'
}

/** Fiber state tone. */
export var FIBER_STATE_TONE = {
  PENDING: 'warn',
  LOADING: '',
  ACTIVE: 'good',
  FAILED: 'bad',
  DISPOSED: '',
  UNLOADING: 'warn'
}
