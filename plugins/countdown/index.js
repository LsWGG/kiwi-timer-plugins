/**
 * Kiwi 组件插件：倒计时。
 *
 * - 两种模式：自定义时长（预设 + 逐分钟微调）或指定时刻（年月日时分秒）。
 * - 使用 endsAt 时间戳持久化运行状态，刷新或重新打开笔记后可接续。
 * - 结束时播放提示音（Web Audio，可关闭），并累计完成次数。
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

  const pad = (value) => String(value).padStart(2, '0')

  function formatClock(seconds) {
    const total = Math.max(0, Math.round(seconds))
    const days = Math.floor(total / 86400)
    const hours = Math.floor((total % 86400) / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const secs = total % 60
    if (days > 0) {
      return `${days}天 ${pad(hours)}:${pad(minutes)}:${pad(secs)}`
    }
    return hours > 0
      ? `${hours}:${pad(minutes)}:${pad(secs)}`
      : `${pad(minutes)}:${pad(secs)}`
  }

  function formatDateTime(timestamp) {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return ''
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    )
  }

  const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

  function startOfDay(timestamp) {
    const date = new Date(timestamp)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  function sameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    )
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
      const pickerOpen = ref(false)
      const pickerMonth = ref({ year: 0, month: 0 })
      let pickerEl = null
      let rootEl = null
      let resizeObserver = null
      let ticker = null
      let completedEndsAt = 0
      let audioCtx = null
      const rootWidth = ref(0)
      const isNarrow = ref(false)

      const title = computed(() => {
        const raw = String(props.blockProps?.title || '倒计时').trim()
        return (raw || '倒计时').slice(0, 40)
      })
      const mode = computed(() =>
        props.blockProps?.mode === 'target' ? 'target' : 'duration',
      )
      const durationSeconds = computed(() =>
        clamp(
          Math.round(Number(props.blockProps?.durationSeconds) || 600),
          MIN_SECONDS,
          MAX_SECONDS,
        ),
      )
      const running = computed(() => Boolean(props.blockProps?.running))
      const endsAt = computed(() => Number(props.blockProps?.endsAt) || 0)
      const targetAt = computed(() => Number(props.blockProps?.targetAt) || 0)
      const startedAt = computed(() => Number(props.blockProps?.startedAt) || 0)
      const soundEnabled = computed(() => props.blockProps?.soundEnabled !== false)
      const completedCount = computed(() =>
        Math.max(0, Math.round(Number(props.blockProps?.completedCount) || 0)),
      )

      const remaining = computed(() => {
        if (running.value && endsAt.value > 0) {
          return Math.max(0, Math.ceil((endsAt.value - now.value) / 1000))
        }
        if (mode.value === 'target' && targetAt.value > 0) {
          return Math.max(0, Math.ceil((targetAt.value - now.value) / 1000))
        }
        const saved = Number(props.blockProps?.remaining)
        return Number.isFinite(saved) && saved >= 0
          ? Math.min(durationSeconds.value, Math.round(saved))
          : durationSeconds.value
      })

      const finished = computed(() => {
        if (running.value) return false
        if (mode.value === 'target' && targetAt.value > 0) {
          return targetAt.value <= now.value
        }
        return remaining.value <= 0
      })

      /** 进度条以本轮开始时的剩余秒数为基准；未开始时保持满格。 */
      const totalSeconds = computed(() => {
        if (running.value && endsAt.value > 0 && startedAt.value > 0) {
          return Math.max(1, Math.round((endsAt.value - startedAt.value) / 1000))
        }
        if (mode.value === 'target') {
          return Math.max(1, remaining.value)
        }
        return durationSeconds.value
      })
      const progress = computed(() => {
        if (!totalSeconds.value) return 0
        return clamp((remaining.value / totalSeconds.value) * 100, 0, 100)
      })

      function commit(patch) {
        if (props.readonly || typeof props.updateProps !== 'function') return
        props.updateProps(patch)
      }

      function audioContext() {
        if (audioCtx && audioCtx.state !== 'closed') return audioCtx
        const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext
        if (!Ctor) return null
        try {
          audioCtx = new Ctor()
        } catch {
          audioCtx = null
        }
        return audioCtx
      }

      /** 开始按钮是用户手势，在这里唤醒 AudioContext，结束时才能发声。 */
      function primeAudio() {
        if (!soundEnabled.value) return
        const ctx = audioContext()
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => {})
        }
      }

      function playAlarm() {
        if (!soundEnabled.value) return
        const ctx = audioContext()
        if (!ctx) return
        const ring = () => {
          const base = ctx.currentTime
          ;[0, 0.28, 0.56].forEach((offset, index) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.setValueAtTime(index === 2 ? 1046.5 : 880, base + offset)
            gain.gain.setValueAtTime(0.0001, base + offset)
            gain.gain.exponentialRampToValueAtTime(0.16, base + offset + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, base + offset + 0.22)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(base + offset)
            osc.stop(base + offset + 0.24)
          })
        }
        if (ctx.state === 'suspended') {
          ctx.resume().then(ring).catch(() => {})
        } else {
          ring()
        }
      }

      function start() {
        if (props.readonly) return
        now.value = Date.now()
        if (mode.value === 'target') {
          let target = targetAt.value
          if (!target || target <= now.value) {
            // 目标已过：按保存的时长顺延一次，避免「再来一次」失效。
            target = now.value + durationSeconds.value * 1000
          }
          const seconds = Math.max(1, Math.ceil((target - now.value) / 1000))
          primeAudio()
          commit({
            targetAt: target,
            running: true,
            endsAt: target,
            startedAt: now.value,
            remaining: seconds,
          })
          return
        }
        const seconds = remaining.value > 0 ? remaining.value : durationSeconds.value
        primeAudio()
        commit({
          running: true,
          endsAt: now.value + seconds * 1000,
          startedAt: now.value,
          remaining: seconds,
        })
      }

      function pause() {
        if (props.readonly) return
        // 指定时刻模式暂停后仍以 targetAt 计算剩余，恢复时继续倒向同一时刻。
        commit({ running: false, endsAt: 0 })
      }

      function toggle() {
        if (running.value) pause()
        else start()
      }

      function reset() {
        if (props.readonly) return
        now.value = Date.now()
        if (mode.value === 'target') {
          commit({
            running: false,
            endsAt: 0,
            startedAt: 0,
            remaining: 0,
            targetAt: now.value + durationSeconds.value * 1000,
          })
          return
        }
        commit({
          running: false,
          endsAt: 0,
          startedAt: 0,
          remaining: durationSeconds.value,
        })
      }

      function setMode(next) {
        if (props.readonly || running.value) return
        if (next === mode.value) return
        if (next === 'target') {
          commit({
            mode: 'target',
            running: false,
            endsAt: 0,
            startedAt: 0,
            targetAt: Date.now() + durationSeconds.value * 1000,
          })
        } else {
          commit({
            mode: 'duration',
            running: false,
            endsAt: 0,
            startedAt: 0,
            remaining: durationSeconds.value,
          })
        }
        now.value = Date.now()
      }

      /** 目标时刻当前值：未设置时以「现在 + 时长」作为默认落点。 */
      function targetDateValue() {
        return new Date(
          targetAt.value > 0 ? targetAt.value : Date.now() + durationSeconds.value * 1000,
        )
      }

      function applyTarget(timestamp) {
        if (props.readonly || !Number.isFinite(timestamp)) return
        commit({
          mode: 'target',
          targetAt: timestamp,
          running: false,
          endsAt: 0,
          startedAt: 0,
          remaining: Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)),
        })
        now.value = Date.now()
        const date = new Date(timestamp)
        pickerMonth.value = { year: date.getFullYear(), month: date.getMonth() }
      }

      function togglePicker() {
        if (props.readonly) return
        if (pickerOpen.value) {
          pickerOpen.value = false
          return
        }
        const date = targetDateValue()
        pickerMonth.value = { year: date.getFullYear(), month: date.getMonth() }
        pickerOpen.value = true
      }

      function shiftPickerMonth(delta) {
        const next = new Date(pickerMonth.value.year, pickerMonth.value.month + delta, 1)
        pickerMonth.value = { year: next.getFullYear(), month: next.getMonth() }
      }

      /** 固定 6 行 × 7 列，切换月份时弹层高度不跳动。 */
      const calendarCells = computed(() => {
        const { year, month } = pickerMonth.value
        const first = new Date(year, month, 1)
        const offset = (first.getDay() + 6) % 7 // 周一为一周起点
        const total = new Date(year, month + 1, 0).getDate()
        const prevTotal = new Date(year, month, 0).getDate()
        const cells = []
        for (let i = offset - 1; i >= 0; i -= 1) {
          cells.push({
            key: `p${i}`,
            date: new Date(year, month - 1, prevTotal - i),
            inMonth: false,
          })
        }
        for (let day = 1; day <= total; day += 1) {
          cells.push({ key: `c${day}`, date: new Date(year, month, day), inMonth: true })
        }
        let next = 1
        while (cells.length < 42) {
          cells.push({
            key: `n${next}`,
            date: new Date(year, month + 1, next),
            inMonth: false,
          })
          next += 1
        }
        return cells
      })

      const pickerTime = computed(() => {
        const date = targetDateValue()
        return {
          hour: pad(date.getHours()),
          minute: pad(date.getMinutes()),
          second: pad(date.getSeconds()),
        }
      })

      function adjustPickerTime(unit, delta) {
        if (props.readonly) return
        const date = targetDateValue()
        if (unit === 'hour') date.setHours(date.getHours() + delta)
        else if (unit === 'minute') date.setMinutes(date.getMinutes() + delta)
        else date.setSeconds(date.getSeconds() + delta)
        const timestamp = Math.max(date.getTime(), Date.now() + 1000)
        applyTarget(timestamp)
      }

      function pickDay(cell) {
        if (props.readonly) return
        if (startOfDay(cell.date.getTime()) < startOfDay(Date.now())) return
        const base = targetDateValue()
        const next = new Date(
          cell.date.getFullYear(),
          cell.date.getMonth(),
          cell.date.getDate(),
          base.getHours(),
          base.getMinutes(),
          base.getSeconds(),
        )
        applyTarget(Math.max(next.getTime(), Date.now() + 1000))
      }

      function clearTarget() {
        if (props.readonly) return
        pickerOpen.value = false
        commit({
          mode: 'target',
          targetAt: 0,
          running: false,
          endsAt: 0,
          startedAt: 0,
          remaining: durationSeconds.value,
        })
        now.value = Date.now()
      }

      function onPickerPointerDown(event) {
        if (!pickerOpen.value) return
        if (pickerEl && pickerEl.contains(event.target)) return
        pickerOpen.value = false
      }

      function onPickerKeydown(event) {
        if (event.key === 'Escape') pickerOpen.value = false
      }

      function toggleSound() {
        if (props.readonly) return
        const next = !soundEnabled.value
        commit({ soundEnabled: next })
        if (next) primeAudio()
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
          startedAt: 0,
          remaining: 0,
          completedCount: next,
        })
        playAlarm()
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
        document.addEventListener('mousedown', onPickerPointerDown, true)
        document.addEventListener('keydown', onPickerKeydown)
        // 用 ResizeObserver 代替 container-type：容器查询会创建层叠上下文，
        // 导致日期弹层被后续带 backdrop-filter 的行内元素（如代码胶囊）盖住。
        if (rootEl && typeof ResizeObserver === 'function') {
          resizeObserver = new ResizeObserver(() => {
            if (!rootEl) return
            const width = rootEl.clientWidth
            rootWidth.value = width
            isNarrow.value = width > 0 && width < 300
          })
          resizeObserver.observe(rootEl)
        }
      })

      onBeforeUnmount(() => {
        if (ticker) window.clearInterval(ticker)
        ticker = null
        if (resizeObserver) resizeObserver.disconnect()
        resizeObserver = null
        rootEl = null
        document.removeEventListener('mousedown', onPickerPointerDown, true)
        document.removeEventListener('keydown', onPickerKeydown)
      })

      function renderModeTabs() {
        if (props.readonly || running.value) return null
        return h('div', { class: 'kiwi-countdown__modes' }, [
          h(
            'button',
            {
              type: 'button',
              class: [
                'kiwi-countdown__mode',
                mode.value === 'duration' ? 'is-active' : '',
              ],
              onClick: () => setMode('duration'),
            },
            '按时长',
          ),
          h(
            'button',
            {
              type: 'button',
              class: [
                'kiwi-countdown__mode',
                mode.value === 'target' ? 'is-active' : '',
              ],
              onClick: () => setMode('target'),
            },
            '指定时刻',
          ),
        ])
      }

      function renderPresets() {
        if (props.readonly || running.value || mode.value === 'target') return null
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

      function renderChevron(direction) {
        const paths = {
          up: 'M2.5 7.25 6 3.75l3.5 3.5',
          down: 'M2.5 4.75 6 8.25l3.5-3.5',
          left: 'M7.25 2.5 3.75 6l3.5 3.5',
          right: 'M4.75 2.5 8.25 6l-3.5 3.5',
        }
        return h(
          'svg',
          {
            viewBox: '0 0 12 12',
            width: '10',
            height: '10',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '1.5',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'aria-hidden': 'true',
          },
          [h('path', { d: paths[direction] })],
        )
      }

      function renderClockColumn(label, unit, value) {
        return h('div', { class: 'kiwi-countdown__clock-col' }, [
          h('span', { class: 'kiwi-countdown__clock-label' }, label),
          h(
            'button',
            {
              type: 'button',
              class: 'kiwi-countdown__clock-step',
              title: `${label} +1`,
              onClick: () => adjustPickerTime(unit, 1),
            },
            [renderChevron('up')],
          ),
          h('span', { class: 'kiwi-countdown__clock-value' }, value),
          h(
            'button',
            {
              type: 'button',
              class: 'kiwi-countdown__clock-step',
              title: `${label} -1`,
              onClick: () => adjustPickerTime(unit, -1),
            },
            [renderChevron('down')],
          ),
        ])
      }

      /** 插件内自绘日历 + 时分秒步进，避免使用浏览器原生的日期选择弹层。 */
      function renderCalendar() {
        const selected = targetAt.value > 0 ? new Date(targetAt.value) : null
        const today = new Date()
        const todayStart = startOfDay(today.getTime())
        return h('div', { class: 'kiwi-countdown__calendar' }, [
          h('div', { class: 'kiwi-countdown__cal-main' }, [
            h('div', { class: 'kiwi-countdown__cal-head' }, [
              h(
                'button',
                {
                  type: 'button',
                  class: 'kiwi-countdown__cal-nav',
                  title: '上个月',
                  'aria-label': '上个月',
                  onClick: () => shiftPickerMonth(-1),
                },
                [renderChevron('left')],
              ),
              h(
                'span',
                { class: 'kiwi-countdown__cal-title' },
                `${pickerMonth.value.year}年${pickerMonth.value.month + 1}月`,
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'kiwi-countdown__cal-nav',
                  title: '下个月',
                  'aria-label': '下个月',
                  onClick: () => shiftPickerMonth(1),
                },
                [renderChevron('right')],
              ),
            ]),
            h(
              'div',
              { class: 'kiwi-countdown__cal-weekdays' },
              WEEKDAYS.map((label) =>
                h('span', { class: 'kiwi-countdown__cal-weekday' }, label),
              ),
            ),
            h(
              'div',
              { class: 'kiwi-countdown__cal-grid' },
              calendarCells.value.map((cell) => {
                const past = startOfDay(cell.date.getTime()) < todayStart
                return h(
                  'button',
                  {
                    type: 'button',
                    class: [
                      'kiwi-countdown__cal-day',
                      cell.inMonth ? '' : 'is-outside',
                      selected && sameDay(selected, cell.date) ? 'is-selected' : '',
                      sameDay(today, cell.date) ? 'is-today' : '',
                      past ? 'is-past' : '',
                    ],
                    disabled: past,
                    onClick: () => pickDay(cell),
                  },
                  cell.date.getDate(),
                )
              }),
            ),
          ]),
          h('div', { class: 'kiwi-countdown__clock' }, [
            renderClockColumn('时', 'hour', pickerTime.value.hour),
            renderClockColumn('分', 'minute', pickerTime.value.minute),
            renderClockColumn('秒', 'second', pickerTime.value.second),
          ]),
          h('div', { class: 'kiwi-countdown__cal-foot' }, [
            h(
              'button',
              {
                type: 'button',
                class: 'kiwi-countdown__cal-action',
                onClick: clearTarget,
              },
              '清除',
            ),
            h(
              'button',
              {
                type: 'button',
                class: ['kiwi-countdown__cal-action', 'is-primary'],
                onClick: () => {
                  pickerOpen.value = false
                },
              },
              '完成',
            ),
          ]),
        ])
      }

      function renderTargetPicker() {
        if (props.readonly || running.value || mode.value !== 'target') return null
        return h('div', { class: 'kiwi-countdown__target' }, [
          h('label', { class: 'kiwi-countdown__target-label' }, '目标时刻'),
          h(
            'div',
            {
              class: 'kiwi-countdown__picker',
              ref: (el) => {
                pickerEl = el
              },
            },
            [
              h(
                'button',
                {
                  type: 'button',
                  class: [
                    'kiwi-countdown__target-trigger',
                    pickerOpen.value ? 'is-open' : '',
                  ],
                  'aria-expanded': pickerOpen.value ? 'true' : 'false',
                  onClick: togglePicker,
                },
                [
                  h(
                    'span',
                    {
                      class: [
                        'kiwi-countdown__target-value',
                        targetAt.value > 0 ? '' : 'is-empty',
                      ],
                    },
                    targetAt.value > 0 ? formatDateTime(targetAt.value) : '选择日期时间',
                  ),
                  h('span', { class: 'kiwi-countdown__target-icon' }, [
                    h(
                      'svg',
                      {
                        viewBox: '0 0 16 16',
                        width: '12',
                        height: '12',
                        fill: 'none',
                        stroke: 'currentColor',
                        'stroke-width': '1.4',
                        'stroke-linecap': 'round',
                        'stroke-linejoin': 'round',
                        'aria-hidden': 'true',
                      },
                      [
                        h('rect', {
                          x: '2.5',
                          y: '3.5',
                          width: '11',
                          height: '9.5',
                          rx: '1.6',
                        }),
                        h('path', { d: 'M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2' }),
                      ],
                    ),
                  ]),
                ],
              ),
              pickerOpen.value ? renderCalendar() : null,
            ],
          ),
          h(
            'span',
            { class: 'kiwi-countdown__target-hint' },
            '精确到秒；开始后倒向该时刻',
          ),
        ])
      }

      return function render() {
        const paused =
          !running.value &&
          !finished.value &&
          (startedAt.value > 0 ||
            (mode.value === 'duration' && remaining.value < durationSeconds.value))
        const status = running.value
          ? '进行中'
          : finished.value
            ? '已结束'
            : paused
              ? '已暂停'
              : '准备开始'
        const metaParts = [status]
        if (mode.value === 'target' && targetAt.value > 0) {
          metaParts.push(`目标 ${formatDateTime(targetAt.value)}`)
        }
        if (completedCount.value > 0) {
          metaParts.push(`已完成 ${completedCount.value} 次`)
        }
        return h(
          'div',
          {
            ref: (el) => {
              rootEl = el
            },
            class: [
              'kiwi-countdown',
              isNarrow.value ? 'is-narrow' : '',
              running.value ? 'is-running' : '',
              finished.value ? 'is-finished' : '',
              props.readonly ? 'is-readonly' : '',
              props.selected ? 'is-selected' : '',
            ],
            style: rootWidth.value
              ? { '--countdown-width': `${rootWidth.value}px` }
              : null,
          },
          [
            h('div', { class: 'kiwi-countdown__head' }, [
              h('span', { class: 'kiwi-countdown__mark' }, '⏱'),
              h('div', { class: 'kiwi-countdown__titles' }, [
                h('p', { class: 'kiwi-countdown__title' }, title.value),
                h(
                  'p',
                  { class: 'kiwi-countdown__meta' },
                  metaParts.join(' · '),
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
                      title: mode.value === 'target' ? '顺延一个时长' : '重置到完整时长',
                    },
                    '重置',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: [
                        'kiwi-countdown__ghost',
                        'kiwi-countdown__sound',
                        soundEnabled.value ? '' : 'is-muted',
                      ],
                      title: soundEnabled.value ? '关闭结束提示音' : '开启结束提示音',
                      onClick: toggleSound,
                    },
                    soundEnabled.value ? '🔔 提示音' : '🔕 静音',
                  ),
                ]),
            renderModeTabs(),
            renderTargetPicker(),
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
          mode: 'duration',
          durationSeconds: 600,
          remaining: 600,
          running: false,
          endsAt: 0,
          startedAt: 0,
          targetAt: 0,
          soundEnabled: true,
          completedCount: 0,
        },
      },
    },
  }
}
