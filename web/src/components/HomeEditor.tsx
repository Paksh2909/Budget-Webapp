import { Eye, EyeOff, GripVertical } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { moveItem, tileLabel, type TileId } from '../homeLayout';

interface Props {
  order: TileId[];
  hidden: Set<TileId>;
  onChange: (order: TileId[], hidden: Set<TileId>) => void;
}

/** Reorder (drag the handle, or arrow keys on it) and show/hide Home tiles. */
export function HomeEditor({ order, hidden, onChange }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const [dragging, setDragging] = useState<TileId | null>(null);
  const [offset, setOffset] = useState(0); // px the dragged row is shifted from its slot
  const drag = useRef<{ id: TileId; startY: number; rowH: number } | null>(null);
  const [announce, setAnnounce] = useState('');

  const rows = () => [...(listRef.current?.querySelectorAll<HTMLLIElement>('li[data-id]') ?? [])];

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, id: TileId) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const row = e.currentTarget.closest('li')!;
    drag.current = { id, startY: e.clientY, rowH: row.getBoundingClientRect().height + 8 };
    setDragging(id);
    setOffset(0);
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    const from = order.indexOf(d.id);
    // Each full row height dragged past moves the tile one slot.
    const steps = Math.round(dy / d.rowH);
    const to = Math.max(0, Math.min(order.length - 1, from + steps));
    if (to !== from) {
      onChange(moveItem(order, from, to), hidden);
      d.startY += (to - from) * d.rowH;
      setOffset(e.clientY - d.startY);
    } else setOffset(dy);
  };

  const endDrag = () => {
    if (drag.current) setAnnounce(`${tileLabel(drag.current.id)} moved to position ${order.indexOf(drag.current.id) + 1}`);
    drag.current = null;
    setDragging(null);
    setOffset(0);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, id: TileId) => {
    const from = order.indexOf(id);
    const to = e.key === 'ArrowUp' ? from - 1 : e.key === 'ArrowDown' ? from + 1 : null;
    if (to === null || to < 0 || to >= order.length) return;
    e.preventDefault();
    onChange(moveItem(order, from, to), hidden);
    setAnnounce(`${tileLabel(id)} moved to position ${to + 1} of ${order.length}`);
    // Keep focus on the moved handle after re-render.
    requestAnimationFrame(() => rows()[to]?.querySelector<HTMLButtonElement>('.drag-handle')?.focus());
  };

  const toggle = (id: TileId) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(order, next);
  };

  return (
    <section className="card home-editor" aria-labelledby="home-editor-title">
      <h2 id="home-editor-title" className="card-title">
        Customize Home
      </h2>
      <p className="muted small">Drag ⋮⋮ to reorder. Tap the eye to show or hide a tile.</p>
      <ul ref={listRef} className="editor-list">
        {order.map((id) => {
          const isHidden = hidden.has(id);
          const isDragging = dragging === id;
          return (
            <li
              key={id}
              data-id={id}
              className={'editor-row' + (isHidden ? ' is-hidden' : '') + (isDragging ? ' dragging' : '')}
              style={isDragging ? { transform: `translateY(${offset}px)` } : undefined}
            >
              <button
                className="drag-handle"
                aria-label={`Reorder ${tileLabel(id)}. Use arrow keys to move.`}
                aria-roledescription="drag handle"
                onPointerDown={(e) => onPointerDown(e, id)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={(e) => onKey(e, id)}
              >
                <GripVertical size={20} aria-hidden="true" />
              </button>
              <span className="editor-label">{tileLabel(id)}</span>
              <button
                className="icon-btn"
                onClick={() => toggle(id)}
                aria-pressed={!isHidden}
                aria-label={isHidden ? `Show ${tileLabel(id)}` : `Hide ${tileLabel(id)}`}
              >
                {isHidden ? <EyeOff size={20} className="muted" /> : <Eye size={20} />}
              </button>
            </li>
          );
        })}
      </ul>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </section>
  );
}
