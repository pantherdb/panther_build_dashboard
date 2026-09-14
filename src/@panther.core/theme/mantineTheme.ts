import {
  ActionIcon,
  Anchor,
  Button,
  Checkbox,
  Code,
  Divider,
  Menu,
  Modal,
  MultiSelect,
  Paper,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Switch,
  Tabs,
  TextInput,
  Tooltip,
  createTheme,
} from '@mantine/core'

/**
 * Mantine theme for the app.
 *
 * Mantine owns interactive controls; the token layer in `src/index.css` owns
 * colour. So this file contains NO colour value of any kind - not a hex, not a
 * `colors` tuple, not a `color` default prop. `primaryColor` stays on Mantine's
 * built-in `blue`, and `index.css` re-points the Mantine semantic variables
 * (`--mantine-primary-color-filled`, `--mantine-color-body`, ...) at our
 * accent and surfaces. That keeps every literal in one file and keeps status
 * colour out of component props, where the token layer could not see it.
 *
 * Everything here is sizing, density and radius: a build report is dense, so the
 * controls default small once here rather than at 200 call sites.
 */
export const mantineTheme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'sm',
  focusRing: 'auto',
  cursorType: 'pointer',
  fontFamily:
    'system-ui, -apple-system, "Segoe UI Variable Display", "Segoe UI", Roboto, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, monospace',
  // Kept in step with the Tailwind type scale in index.css, so a Mantine control
  // and the text beside it agree on size.
  fontSizes: {
    xs: '0.75rem',
    sm: '0.8125rem',
    md: '0.875rem',
    lg: '1.0625rem',
    xl: '1.25rem',
  },
  lineHeights: {
    xs: '1.35',
    sm: '1.4',
    md: '1.45',
    lg: '1.45',
    xl: '1.4',
  },
  // Denser than Mantine's default, but no longer cramped. The previous scale
  // topped out at 1rem, which - paired with panel padding that matched it - is
  // what made the report read as packed rather than dense. Raised roughly one
  // step throughout; the report should still fit a lot on screen, just not
  // touch its own edges.
  spacing: {
    xs: '0.375rem',
    sm: '0.5rem',
    md: '0.75rem',
    lg: '1rem',
    xl: '1.5rem',
  },
  radius: {
    xs: '1px',
    sm: '2px',
    md: '3px',
    lg: '4px',
    xl: '6px',
  },
  headings: {
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '1.25rem', lineHeight: '1.3' },
      h2: { fontSize: '1.0625rem', lineHeight: '1.3' },
      h3: { fontSize: '0.9375rem', lineHeight: '1.35' },
      h4: { fontSize: '0.8125rem', lineHeight: '1.35' },
    },
  },
  components: {
    Button: Button.extend({
      defaultProps: { size: 'compact-xs', variant: 'default' },
      styles: { root: { textTransform: 'none', fontWeight: 500 } },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: { variant: 'subtle', color: 'gray', size: 'sm' },
    }),
    Anchor: Anchor.extend({
      defaultProps: { underline: 'hover', size: 'sm' },
    }),
    TextInput: TextInput.extend({ defaultProps: { size: 'xs' } }),
    Select: Select.extend({
      defaultProps: { size: 'xs', allowDeselect: false, comboboxProps: { withinPortal: true } },
    }),
    MultiSelect: MultiSelect.extend({
      defaultProps: { size: 'xs', comboboxProps: { withinPortal: true } },
    }),
    Checkbox: Checkbox.extend({ defaultProps: { size: 'xs' } }),
    Switch: Switch.extend({ defaultProps: { size: 'xs' } }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { size: 'xs', radius: 'sm', withItemsBorders: false },
    }),
    Tabs: Tabs.extend({ defaultProps: { variant: 'default', keepMounted: false } }),
    // `focus` and `touch` are off in Mantine's own default, which makes every tooltip in the app
    // mouse-only. `focus: true` matters because a `tabIndex` is otherwise inert — without it every
    // definition (DefinedTerm, MetricValue) stays unreachable from the keyboard. `touch: true`
    // matters because a non-interactive label span has no click handler of its own; a tap is the
    // only route to its definition on a touch device. This default is theme-wide, so it was
    // audited against the app's other Tooltip call sites (icon buttons, sortable headers, links):
    // floating-ui's `useFocus` runs `visibleOnly`, gated on `:focus-visible`, so a mouse click that
    // focuses a control does not open its tooltip — only tabbing to it does, which is a strict
    // improvement, not a regression. The accepted cost is that a tap on an already-tappable control
    // can now also surface its tooltip shortly after; it never blocks the tap's own action.
    Tooltip: Tooltip.extend({
      defaultProps: {
        withArrow: true,
        openDelay: 200,
        fz: 'xs',
        maw: 300,
        multiline: true,
        events: { hover: true, focus: true, touch: true },
      },
    }),
    Popover: Popover.extend({
      defaultProps: { withinPortal: true, shadow: 'none', radius: 'sm', withArrow: true },
    }),
    Menu: Menu.extend({
      defaultProps: { withinPortal: true, shadow: 'none', radius: 'sm' },
    }),
    Modal: Modal.extend({
      defaultProps: { radius: 'sm', centered: true, size: 'lg', shadow: 'none' },
    }),
    // Mantine's Paper is the card-on-gray look the brief rules out. Flattening
    // it here means an accidental <Paper> cannot reintroduce elevation; use
    // `Panel` instead.
    Paper: Paper.extend({
      defaultProps: { shadow: 'none', radius: 'sm', withBorder: false, p: 0 },
    }),
    Divider: Divider.extend({ defaultProps: { size: 1 } }),
    Code: Code.extend({ defaultProps: { fz: 'xs' } }),
    ScrollArea: ScrollArea.extend({
      defaultProps: { type: 'auto', scrollbarSize: 8, offsetScrollbars: false },
    }),
  },
})
