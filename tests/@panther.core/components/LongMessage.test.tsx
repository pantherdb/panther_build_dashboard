import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LONG_MESSAGE_THRESHOLD, LongMessage } from '@/@panther.core/components/LongMessage'
import { renderWithProviders } from '@tests/test-utils'

/**
 * The presentation fix for the ~10 KB `config_file_contents` generator warning: collapse a long
 * or multi-line message by default, without touching what the message SAYS. Every assertion here
 * is about what is on screen, never about rewording - the full text must still be reachable, just
 * not dumped on screen unasked.
 */

describe('a short message', () => {
  it('renders exactly as plain text, with no toggle', () => {
    const message =
      'refProteomePANTHERmapping_updated_hmm is newer than tribe_mcl_reclustering.touch'
    renderWithProviders(<LongMessage message={message} />)

    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders a message right at the threshold without a toggle', () => {
    const message = 'y'.repeat(LONG_MESSAGE_THRESHOLD)
    renderWithProviders(<LongMessage message={message} />)

    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('a message over the character threshold, no newline', () => {
  const line = 'x'.repeat(LONG_MESSAGE_THRESHOLD + 50)

  it('collapses by default, with the full text not on screen', () => {
    renderWithProviders(<LongMessage message={line} />)

    expect(screen.queryByText(line)).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Show full message' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('expands to the full text and collapses again on toggle', async () => {
    const { user, container } = renderWithProviders(<LongMessage message={line} />)

    await user.click(screen.getByRole('button', { name: 'Show full message' }))

    expect(screen.getByText(line)).toBeInTheDocument()
    expect(container.querySelector('pre')).not.toBeNull()
    const collapseToggle = screen.getByRole('button', { name: 'Show less' })
    expect(collapseToggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(collapseToggle)

    expect(screen.queryByText(line)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show full message' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })
})

describe('a multi-line message under the character threshold', () => {
  const message = 'first line\nsecond line\nthird line'

  it('collapses by default even though it is short, showing only the first line', () => {
    renderWithProviders(<LongMessage message={message} />)

    expect(screen.getByText(/^first line/)).toBeInTheDocument()
    expect(screen.queryByText(/second line/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show full message' })).toBeInTheDocument()
  })

  it('expands to reveal every line', async () => {
    const { user } = renderWithProviders(<LongMessage message={message} />)

    await user.click(screen.getByRole('button', { name: 'Show full message' }))

    expect(screen.getByText(/second line/)).toBeInTheDocument()
    expect(screen.getByText(/third line/)).toBeInTheDocument()
  })
})
