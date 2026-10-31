/**
 * Kiwi 组件插件：竖向时间轴。
 *
 * - 每个时间点由「时间 + 摘要 + 正文」组成，点击箭头展开 / 收起；
 * - 收起时只显示时间与摘要，展开后可以写该时间点的笔记内容；
 * - 正文使用宿主提供的富文本编辑器（`host.components.NoteEditor`），
 *   与文本笔记一样支持待办勾选框、列表、标题等格式；旧宿主回退为 textarea；
 * - 可标记关键时间点（琥珀色圆点），可自由增删时间点；
 * - 状态全部保存在 props.points 中，随笔记一起持久化。
 */
export function setup(host) {
  const { defineComponent, h, ref, computed } = host.vue
  const toast = host.toast
  // 可选宿主能力：旧版本 Kiwi 没有 components，回退为纯文本输入。
  const NoteEditor = host.components && host.components.NoteEditor

  const MAX_POINTS = 200
  const MAX_TIME = 40
  const MAX_SUMMARY = 120
  const MAX_CONTENT = 20000

  function text(value, max) {
    return String(value ?? '').slice(0, max)
  }

  function normalizePoints(raw) {
    if (!Array.isArray(raw)) return []
    return raw.slice(0, MAX_POINTS).map((item, index) => ({
      id: text(item && item.id, 64) || `p${index}`,
      time: text(item && item.time, MAX_TIME),
      summary: text(item && item.summary, MAX_SUMMARY),
      content: text(item && item.content, MAX_CONTENT),
      key: Boolean(item && item.key),
    }))
  }

  function newId() {
    return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  }

  function nowLabel() {
    const date = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  const TimelineBlock = defineComponent({
    name: 'KiwiTimelineBlock',
    props: {
      blockProps: { type: Object, default: () => ({}) },
      readonly: { type: Boolean, default: false },
      selected: { type: Boolean, default: false },
      updateProps: { type: Function, default: null },
      deleteBlock: { type: Function, default: null },
    },
    setup(props) {
      const expanded = ref(new Set())

      const points = computed(() => normalizePoints(props.blockProps?.points))
      const title = computed(() => text(props.blockProps?.title, 60) || '时间轴')

      function commit(patch) {
        if (props.readonly || typeof props.updateProps !== 'function') return
        props.updateProps(patch)
      }

      function commitPoints(next) {
        commit({ points: next })
      }

      function isOpen(id) {
        return expanded.value.has(id)
      }

      function toggleOpen(id) {
        const next = new Set(expanded.value)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        expanded.value = next
      }

      function updatePoint(id, patch) {
        if (props.readonly) return
        commitPoints(
          points.value.map((point) =>
            point.id === id ? { ...point, ...patch } : point,
          ),
        )
      }

      function addPoint() {
        if (props.readonly) return
        if (points.value.length >= MAX_POINTS) {
          if (toast && typeof toast.error === 'function') {
            toast.error(`最多支持 ${MAX_POINTS} 个时间点`)
          }
          return
        }
        const point = {
          id: newId(),
          time: nowLabel(),
          summary: '',
          content: '',
          key: false,
        }
        commitPoints([...points.value, point])
        expanded.value = new Set([...expanded.value, point.id])
      }

      function removePoint(id) {
        if (props.readonly) return
        commitPoints(points.value.filter((point) => point.id !== id))
        if (expanded.value.has(id)) {
          const next = new Set(expanded.value)
          next.delete(id)
          expanded.value = next
        }
      }

      function renderTitle() {
        if (props.readonly) {
          return h('p', { class: 'kiwi-timeline__title' }, title.value)
        }
        return h('input', {
          class: 'kiwi-timeline__title-input',
          value: title.value,
          placeholder: '时间轴标题',
          'aria-label': '时间轴标题',
          onChange: (event) => commit({ title: text(event.target.value, 60) }),
        })
      }

      function renderContent(point) {
        const empty = !String(point.content || '').trim()
        if (NoteEditor) {
          if (props.readonly && empty) {
            return h(
              'p',
              { class: 'kiwi-timeline__content is-empty' },
              '（无内容）',
            )
          }
          return h(NoteEditor, {
            class: 'kiwi-timeline__editor',
            modelValue: point.content,
            readonly: props.readonly,
            placeholder: '记录这个时间点的笔记；可插入待办勾选框、列表…',
            minHeight: '86px',
            'onUpdate:modelValue': (value) => {
              if (props.readonly) return
              updatePoint(point.id, { content: text(value, MAX_CONTENT) })
            },
          })
        }
        if (props.readonly) {
          return h(
            'p',
            { class: 'kiwi-timeline__content' },
            point.content || '（无内容）',
          )
        }
        return h('textarea', {
          class: 'kiwi-timeline__content-input',
          rows: 4,
          value: point.content,
          placeholder: '写下这个时间点的笔记内容…',
          'aria-label': '时间点内容',
          onChange: (event) =>
            updatePoint(point.id, {
              content: text(event.target.value, MAX_CONTENT),
            }),
        })
      }

      function renderPoint(point) {
        const open = isOpen(point.id)
        const row = [
          props.readonly
            ? h(
                'span',
                { class: 'kiwi-timeline__time', title: point.time },
                point.time || '—',
              )
            : h('input', {
                class: 'kiwi-timeline__time-input',
                value: point.time,
                placeholder: '时间',
                title: '时间点，如 09:00 / 10-29',
                'aria-label': '时间点',
                onChange: (event) =>
                  updatePoint(point.id, { time: text(event.target.value, MAX_TIME) }),
              }),
          props.readonly
            ? h(
                'span',
                { class: 'kiwi-timeline__summary' },
                point.summary || '（无摘要）',
              )
            : h('input', {
                class: 'kiwi-timeline__summary-input',
                value: point.summary,
                placeholder: '摘要（收起时展示）',
                'aria-label': '时间点摘要',
                onChange: (event) =>
                  updatePoint(point.id, {
                    summary: text(event.target.value, MAX_SUMMARY),
                  }),
              }),
          props.readonly
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  class: ['kiwi-timeline__icon', point.key ? 'is-key' : ''],
                  title: point.key ? '取消关键时间点' : '设为关键时间点',
                  'aria-pressed': point.key,
                  onClick: () => updatePoint(point.id, { key: !point.key }),
                },
                point.key ? '★' : '☆',
              ),
          h(
            'button',
            {
              type: 'button',
              class: ['kiwi-timeline__icon', 'kiwi-timeline__expand'],
              title: open ? '收起时间点' : '展开时间点',
              'aria-expanded': open,
              onClick: () => toggleOpen(point.id),
            },
            open ? '▾' : '▸',
          ),
          props.readonly
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  class: ['kiwi-timeline__icon', 'kiwi-timeline__remove'],
                  title: '删除时间点',
                  onClick: () => removePoint(point.id),
                },
                '×',
              ),
        ]

        const body = open ? renderContent(point) : null

        return h(
          'div',
          {
            key: point.id,
            role: 'listitem',
            // 宿主「待办汇总」定位时据此找到对应时间点；旧版宿主不依赖。
            'data-kiwi-point-id': point.id,
            class: [
              'kiwi-timeline__item',
              point.key ? 'is-key' : '',
              open ? 'is-open' : '',
            ],
          },
          [
            h('span', { class: 'kiwi-timeline__rail' }),
            h('span', { class: 'kiwi-timeline__dot' }),
            h('div', { class: 'kiwi-timeline__card' }, [
              h('div', { class: 'kiwi-timeline__row' }, row),
              body,
            ]),
          ],
        )
      }

      return function render() {
        return h(
          'div',
          {
            class: [
              'kiwi-timeline',
              props.readonly ? 'is-readonly' : '',
              props.selected ? 'is-selected' : '',
            ],
          },
          [
            h('div', { class: 'kiwi-timeline__head' }, [
              h('span', { class: 'kiwi-timeline__mark' }, '⌁'),
              h('div', { class: 'kiwi-timeline__titles' }, [
                renderTitle(),
                h(
                  'p',
                  { class: 'kiwi-timeline__meta' },
                  `${points.value.length} 个时间点`,
                ),
              ]),
              props.selected && typeof props.deleteBlock === 'function'
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'kiwi-timeline__remove-block',
                      title: '删除区块',
                      onClick: () => props.deleteBlock(),
                    },
                    '×',
                  )
                : null,
            ]),
            points.value.length
              ? h(
                  // 用 div + role 承载时间轴，避免被笔记正文的
                  // `.ProseMirror ol` 规则渲染出 1 / 2 / 3 序号。
                  'div',
                  { class: 'kiwi-timeline__list', role: 'list' },
                  points.value.map((point) => renderPoint(point)),
                )
              : h(
                  'p',
                  { class: 'kiwi-timeline__empty' },
                  props.readonly ? '暂无时间点' : '还没有时间点，点击下方按钮添加。',
                ),
            props.readonly
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    class: 'kiwi-timeline__add',
                    onClick: addPoint,
                  },
                  '+ 添加时间点',
                ),
          ],
        )
      }
    },
  })

  return {
    blocks: {
      timeline: {
        component: TimelineBlock,
        defaultProps: {
          title: '时间轴',
          points: [
            {
              id: 'p1',
              time: '09:00',
              summary: '开始',
              content: '',
              key: false,
            },
          ],
        },
      },
    },
  }
}
