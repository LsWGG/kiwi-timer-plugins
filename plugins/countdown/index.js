/**
 * Kiwi 组件插件：倒计时。
 *
 * - 自定义时长（预设 + 逐分钟微调），开始 / 暂停 / 重置。
 * - 使用 endsAt 时间戳持久化运行状态，刷新或重新打开笔记后可接续。
 * - 仅在操作与结束时写 props，不会每秒触发自动保存。
 * - 颜色来自 --kiwi-* 主题变量，跟随系统主题色。
 */
export function setup(host) {
  const {
    defineComponent,
    h,
    ref,
    computed,
    onMounted,
    onBeforeUnmount,
  } = host.vue
  const toast = host.toast

  const MIN_SECONDS = 60
  const MAX_SECONDS = 6 * 3600
  const PRESETS = [1, 5, 10, 25, 60]

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.round(seconds))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const secs = total % 60
    const pad = (value) => String(value).padStart(2, '0')
    return hours > 0
      ? `${hours}:${pad(minutes)}:${pad(secs)}`
      : `${pad(minutes)}:${pad(secs)}`
  }

  const CountdownBlock = defineComponent({
    name: 'KiwiCountdownBlock',
    props: {
      blockProps: { type: Object, default: () => ({}) },
      readonly: { type: Boolean, default: false },
      selected: { type: Boolean, default: false },
      updateProps: { type: Function, default: null },
      deleteBlock: { type: Function, default: null },
    },
    setup(props) {
      const now = ref(Date.now())
      let ticker = null
      let completedEndsAt = 0

      const title = computed(() => {
        const raw = String(props.blockProps?.title || '倒计时').trim()
        return (raw || '倒计时').slice(0, 40)
      })
      const durationSeconds = computed(() =>
        clamp(
          Math.round(Number(props.blockProps?.durationSeconds) || 600),
          MIN_SECONDS,
          MAX_SECONDS,
        ),
      )
      const running = computed(() => Boolean(props.blockProps?.running))
      const endsAt = computed(() => Number(props.blockProps?.endsAt) || 0)
      const completedCount = computed(() =>
        Math.max(0, Math.round(Number(props.blockProps?.completedCount) || 0)),
      )

      const remaining = computed(() => {
        if (running.value && endsAt.value > 0) {
          return Math.max(0, Math.ceil((endsAt.value - now.value) / 1000))
        }
        const saved = Number(props.blockProps?.remaining)
        return Number.isFinite(saved) && saved >= 0
          ? Math.min(durationSeconds.value, Math.round(saved))
          : durationSeconds.value
      })

      const finished = computed(
        () => !running.value && remaining.value <= 0,
      )
      const progress = computed(() => {
        if (!durationSeconds.value) return 0
        return clamp((remaining.value / durationSeconds.value) * 100, 0, 100)
      })

      function commit(patch) {
        if (props.readonly || typeof props.updateProps !== 'function') return
        props.updateProps(patch)
      }

      function start() {
        if (props.readonly) return
        const seconds = remaining.value > 0 ? remaining.value : durationSeconds.value
        now.value = Date.now()
        commit({
          running: true,
          endsAt: now.value + seconds * 1000,
          remaining: seconds,
        })
      }

      function pause() {
        if (props.readonly) return
        commit({
          running: false,
          endsAt: 0,
          remaining: remaining.value,
        })
      }

      function toggle() {
        if (running.value) pause()
        else start()
      }

      function reset() {
        if (props.readonly) return
        commit({
          running: false,
          endsAt: 0,
          remaining: durationSeconds.value,
        })
        now.value = Date.now()
      }

      function setDuration(minutes) {
        if (props.readonly || running.value) return
        const seconds = clamp(minutes * 60, MIN_SECONDS, MAX_SECONDS)
        commit({
          durationSeconds: seconds,
          remaining: seconds,
          running: false,
          endsAt: 0,
        })
      }

      function adjustDuration(deltaMinutes) {
        if (props.readonly || running.value) return
        setDuration(Math.round(durationSeconds.value / 60) + deltaMinutes)
      }

      function finish() {
        if (props.readonly || typeof props.updateProps !== 'function') return
        const next = completedCount.value + 1
        commit({
          running: false,
          endsAt: 0,
          remaining: 0,
          completedCount: next,
        })
        if (toast && typeof toast.success === 'function') {
          toast.success(`${title.value}结束`)
        }
      }

      function checkFinished() {
        if (props.readonly || !running.value || !endsAt.value) return
        if (now.value < endsAt.value) return
        if (completedEndsAt === endsAt.value) return
        completedEndsAt = endsAt.value
        finish()
        now.value = Date.now()
      }

      onMounted(() => {
        ticker = window.setInterval(() => {
          now.value = Date.now()
          checkFinished()
        }, 250)
      })

      onBeforeUnmount(() => {
        if (ticker) window.clearInterval(ticker)
        ticker = null
      })

      function renderPresets() {
        if (props.readonly || running.value) return null
        return h('div', { class: 'kiwi-countdown__presets' }, [
          ...PRESETS.map((minutes) =>
            h(
              'button',
              {
                type: 'button',
                class: [
                  'kiwi-countdown__preset',
                  Math.round(durationSeconds.value / 60) === minutes ? 'is-active' : '',
                ],
                onClick: () => setDuration(minutes),
              },
              `${minutes} 分`,
            ),
          ),
          h('span', { class: 'kiwi-countdown__presets-sep' }),
          h(
            'button',
            {
              type: 'button',
              class: 'kiwi-countdown__step',
              title: '减少 1 分钟',
              onClick: () => adjustDuration(-1),
            },
            '−',
          ),
          h(
            'span',
            { class: 'kiwi-countdown__duration' },
            `${Math.round(durationSeconds.value / 60)} 分钟`,
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'kiwi-countdown__step',
              title: '增加 1 分钟',
              onClick: () => adjustDuration(1),
            },
            '+',
          ),
        ])
      }

      return function render() {
        const status = running.value
          ? '进行中'
          : finished.value
            ? '已结束'
            : remaining.value < durationSeconds.value
              ? '已暂停'
              : '准备开始'
        return h(
          'div',
          {
            class: [
              'kiwi-countdown',
              running.value ? 'is-running' : '',
              finished.value ? 'is-finished' : '',
              props.readonly ? 'is-readonly' : '',
              props.selected ? 'is-selected' : '',
            ],
          },
          [
            h('div', { class: 'kiwi-countdown__head' }, [
              h('span', { class: 'kiwi-countdown__mark' }, '⏱'),
              h('div', { class: 'kiwi-countdown__titles' }, [
                h('p', { class: 'kiwi-countdown__title' }, title.value),
                h(
                  'p',
                  { class: 'kiwi-countdown__meta' },
                  completedCount.value > 0
                    ? `${status} · 已完成 ${completedCount.value} 次`
                    : status,
                ),
              ]),
              props.selected && typeof props.deleteBlock === 'function'
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'kiwi-countdown__remove',
                      title: '删除区块',
                      onClick: () => props.deleteBlock(),
                    },
                    '×',
                  )
                : null,
            ]),
            h(
              'div',
              { class: 'kiwi-countdown__time' },
              formatClock(remaining.value),
            ),
            h('div', { class: 'kiwi-countdown__track' }, [
              h('span', {
                class: 'kiwi-countdown__fill',
                style: { width: `${progress.value}%` },
              }),
            ]),
            props.readonly
              ? null
              : h('div', { class: 'kiwi-countdown__actions' }, [
                  h(
                    'button',
                    {
                      type: 'button',
                      class: [
                        'kiwi-countdown__primary',
                        running.value ? 'is-running' : '',
                      ],
                      onClick: toggle,
                    },
                    running.value
                      ? '暂停'
                      : finished.value
                        ? '再来一次'
                        : '开始',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'kiwi-countdown__ghost',
                      onClick: reset,
                      title: '重置到完整时长',
                    },
                    '重置',
                  ),
                ]),
            renderPresets(),
          ],
        )
      }
    },
  })

  return {
    blocks: {
      countdown: {
        component: CountdownBlock,
        defaultProps: {
          title: '倒计时',
          durationSeconds: 600,
          remaining: 600,
          running: false,
          endsAt: 0,
          completedCount: 0,
        },
      },
    },
  }
}
