import clsx from 'clsx'
import { useId, useState } from 'react'

/**
 * A generator message, rendered as-is when short and collapsed by default when long.
 *
 * Generator warnings are quoted verbatim - the report contract's honesty rule - and this stays
 * true here: nothing here rewords the message or drops it from the model, the search index or an
 * export. What it fixes is purely on screen. The live report carries a ~10 KB warning
 * (`config \`config_file_contents\` changed during this build: ...`) that otherwise dwarfs every
 * other finding in the checks list; this component is the one place that decides how much of a
 * message is shown before a reader asks for the rest.
 *
 * A message is "long" when it has more than one line, or is longer than
 * `LONG_MESSAGE_THRESHOLD` characters - whichever comes first, because a message can be short in
 * characters and still be a wall of lines. Anything shorter renders as a bare string, exactly as
 * every call site did before this component existed, so dropping it in at a render site changes
 * nothing for the common case.
 */
export const LONG_MESSAGE_THRESHOLD = 240

/** How much of the first line survives in a clipped preview before the ellipsis. */
const PREVIEW_CHARS = 200

export function isLongMessage(message: string): boolean {
  return message.includes('\n') || message.length > LONG_MESSAGE_THRESHOLD
}

/**
 * The first line, clipped to `PREVIEW_CHARS`, with an ellipsis appended whenever anything was cut
 * - a later line, or the tail of a long first line. Returns the message unchanged when it is not
 * long, so this is also safe to call at a render site that cannot host the full toggle (a
 * tooltip, an inline hint) and only needs a short preview instead.
 */
export function previewMessage(message: string): string {
  if (!isLongMessage(message)) return message
  const newlineIndex = message.indexOf('\n')
  const firstLine = newlineIndex === -1 ? message : message.slice(0, newlineIndex)
  const clipped = firstLine.length > PREVIEW_CHARS ? firstLine.slice(0, PREVIEW_CHARS) : firstLine
  return clipped.length < message.length ? `${clipped}…` : clipped
}

export interface LongMessageProps {
  message: string
  /** Applied to the short-message text and to the collapsed preview row. */
  className?: string
  /** Max height in px of the expanded scrollable block. */
  maxHeight?: number
}

export const LongMessage = ({ message, className, maxHeight = 240 }: LongMessageProps) => {
  const [open, setOpen] = useState(false)
  const panelId = `${useId()}-panel`

  if (!isLongMessage(message)) {
    return <span className={className}>{message}</span>
  }

  return (
    <span className={clsx('block min-w-0', className)}>
      {open ? (
        <pre
          id={panelId}
          data-pb-scroll=""
          className="pb-hairline rounded-hair bg-surface-3 text-2xs overflow-auto p-1.5 leading-4 break-words whitespace-pre-wrap"
          style={{ maxHeight }}
        >
          {message}
        </pre>
      ) : (
        <span className="block truncate">{previewMessage(message)}</span>
      )}
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="text-accent hover:text-accent-hover text-2xs mt-0.5 block"
      >
        {open ? 'Show less' : 'Show full message'}
      </button>
    </span>
  )
}
