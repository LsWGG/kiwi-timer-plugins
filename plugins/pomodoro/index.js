/**
 * Kiwi 组件插件：番茄钟。
 *
 * - focus / break 两阶段循环，默认 25 分钟专注 + 5 分钟休息。
 * - 运行状态用 endsAt（时间戳）持久化，关闭笔记或刷新后仍能接续计时。
 * - 只在开始 / 暂停 / 重置 / 阶段切换时写 props，不会每秒触发自动保存。
 * - 颜色全部来自 --kiwi-* 主题变量，跟随系统主题色。
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

  const PomodoroBlock = defineComponent({
    name: 'KiwiPomodoroBlock',
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

      const focusMinutes = computed(() =>
        clamp(Number(props.blockProps?.focusMinutes) || 25, 5, 90),
      )
      const breakMinutes = computed(() =>
        clamp(Number(props.blockProps?.breakMinutes) || 5, 1, 30),
      )
      const phase = computed(() =>
        props.blockProps?.phase === 'break' ? 'break' : 'focus',
      )
      const running = computed(() => Boolean(props.blockProps?.running))
      const endsAt = computed(() => Number(props.blockProps?.endsAt) || 0)
      const completedFocus = computed(() =>
        Math.max(0, Math.round(Number(props.blockProps?.completedFocus) || 0)),
      )

      const phaseSeconds = computed(
        () => (phase.value === 'break' ? breakMinutes.value : focusMinutes.value) * 60,
      )

      const remaining = computed(() => {
        if (running.value && endsAt.value > 0) {
          return Math.max(0, Math.ceil((endsAt.value - now.value) / 1000))
        }
        const saved = Number(props.blockProps?.remaining)
        return Number.isFinite(saved) && saved >= 0
          ? Math.round(saved)
          : phaseSeconds.value
      })

      const progress = computed(() => {
        if (!phaseSeconds.value) return 0
        return clamp((remaining.value / phaseSeconds.value) * 100, 0, 100)
      })

      function commit(patch) {
        if (props.readonly || typeof props.updateProps !== 'function') return
        props.updateProps(patch)
      }

      function start() {
        if (props.readonly) return
        const seconds = remaining.value > 0 ? remaining.value : phaseSeconds.value
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
        commit({ running: false, endsAt: 0, remaining: phaseSeconds.value })
        now.value = Date.now()
      }

      function nextPhase() {
        if (props.readonly) return
        if (phase.value === 'break') {
          commit({
            phase: 'focus',
            running: false,
            endsAt: 0,
            remaining: focusMinutes.value * 60,
          })
          if (toast && typeof toast.success === 'function') {
            toast.success('休息结束，开始下一轮专注吧')
          }
          return
        }
        const next = completedFocus.value + 1
        commit({
          phase: 'break',
          running: false,
          endsAt: 0,
          remaining: breakMinutes.value * 60,
          completedFocus: next,
        })
        if (toast && typeof toast.success === 'function') {
          toast.success(`第 ${next} 轮专注完成，休息 ${breakMinutes.value} 分钟`)
        }
      }

      function checkFinished() {
        if (props.readonly || !running.value || !endsAt.value) return
        if (now.value < endsAt.value) return
        if (completedEndsAt === endsAt.value) return
        completedEndsAt = endsAt.value
        nextPhase()
        now.value = Date.now()
      }

      function adjust(unit, delta) {
        if (props.readonly || running.value) return
        if (unit === 'focus') {
          const next = clamp(focusMinutes.value + delta, 5, 90)
          if (next === focusMinutes.value) return
          const patch = { focusMinutes: next }
          if (phase.value === 'focus') patch.remaining = next * 60
          commit(patch)
        } else {
          const next = clamp(breakMinutes.value + delta, 1, 30)
          if (next === breakMinutes.value) return
          const patch = { breakMinutes: next }
          if (phase.value === 'break') patch.remaining = next * 60
          commit(patch)
        }
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

      function renderControls() {
        if (props.readonly) return null
        return h('div', { class: 'kiwi-pomodoro__actions' }, [
          h(
            'button',
            {
              type: 'button',
              class: [
                'kiwi-pomodoro__primary',
                running.value ? 'is-running' : '',
              ],
              onClick: toggle,
            },
            running.value ? '暂停' : '开始',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'kiwi-pomodoro__ghost',
              onClick: nextPhase,
              title: '跳到下一阶段',
            },
            '跳过',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'kiwi-pomodoro__ghost',
              onClick: reset,
              title: '重置当前阶段',
            },
            '重置',
          ),
        ])
      }

      function renderSettings() {
        if (props.readonly || running.value) return null
        return h('div', { class: 'kiwi-pomodoro__settings' }, [
          h('span', { class: 'kiwi-pomodoro__setting-group' }, [
            h('span', { class: 'kiwi-pomodoro__settings-label' }, '专注'),
            h(
              'button',
              {
                type: 'button',
                class: 'kiwi-pomodoro__step',
                title: '减少 5 分钟专注时长',
                onClick: () => adjust('focus', -5),
              },
              '−',
            ),
            h('span', { class: 'kiwi-pomodoro__settings-value' }, `${focusMinutes.value} 分`),
            h(
              'button',
              {
                type: 'button',
                class: 'kiwi-pomodoro__step',
                title: '增加 5 分钟专注时长',
                onClick: () => adjust('focus', 5),
              },
              '+',
            ),
          ]),
          h('span', { class: 'kiwi-pomodoro__settings-sep' }, '·'),
          h('span', { class: 'kiwi-pomodoro__setting-group' }, [
            h('span', { class: 'kiwi-pomodoro__settings-label' }, '休息'),
            h(
              'button',
              {
                type: 'button',
                class: 'kiwi-pomodoro__step',
                title: '减少 1 分钟休息时长',
                onClick: () => adjust('break', -1),
              },
              '−',
            ),
            h('span', { class: 'kiwi-pomodoro__settings-value' }, `${breakMinutes.value} 分`),
            h(
              'button',
              {
                type: 'button',
                class: 'kiwi-pomodoro__step',
                title: '增加 1 分钟休息时长',
                onClick: () => adjust('break', 1),
              },
              '+',
            ),
          ]),
        ])
      }

      return function render() {
        const isBreak = phase.value === 'break'
        return h(
          'div',
          {
            class: [
              'kiwi-pomodoro',
              isBreak ? 'is-break' : 'is-focus',
              running.value ? 'is-running' : '',
              props.readonly ? 'is-readonly' : '',
              props.selected ? 'is-selected' : '',
            ],
          },
          [
            h('div', { class: 'kiwi-pomodoro__head' }, [
              h(
                'span',
                { class: 'kiwi-pomodoro__badge' },
                isBreak ? '休息' : '专注',
              ),
              h(
                'span',
                { class: 'kiwi-pomodoro__count' },
                completedFocus.value > 0
                  ? `已完成 ${completedFocus.value} 轮`
                  : '番茄工作法',
              ),
              props.selected && typeof props.deleteBlock === 'function'
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'kiwi-pomodoro__remove',
                      title: '删除区块',
                      onClick: () => props.deleteBlock(),
                    },
                    '×',
                  )
                : null,
            ]),
            h('div', { class: 'kiwi-pomodoro__body' }, [
              h(
                'div',
                {
                  class: 'kiwi-pomodoro__dial',
                  style: { '--progress': String(progress.value) },
                },
                [
                  h('div', { class: 'kiwi-pomodoro__dial-inner' }, [
                    h(
                      'span',
                      { class: 'kiwi-pomodoro__time' },
                      formatClock(remaining.value),
                    ),
                    h(
                      'span',
                      { class: 'kiwi-pomodoro__phase' },
                      running.value
                        ? isBreak
                          ? '休息中'
                          : '专注中'
                        : isBreak
                          ? '准备休息'
                          : '准备专注',
                    ),
                  ]),
                ],
              ),
              h('div', { class: 'kiwi-pomodoro__side' }, [
                h(
                  'p',
                  { class: 'kiwi-pomodoro__tip' },
                  isBreak
                    ? '休息一下，下一轮会更专注。'
                    : '一次只做一件事，完成后自动进入休息。',
                ),
                renderControls(),
              ]),
            ]),
            renderSettings(),
          ],
        )
      }
    },
  })

  return {
    blocks: {
      pomodoro: {
        component: PomodoroBlock,
        defaultProps: {
          focusMinutes: 25,
          breakMinutes: 5,
          phase: 'focus',
          running: false,
          endsAt: 0,
          remaining: 1500,
          completedFocus: 0,
        },
      },
    },
  }
}
