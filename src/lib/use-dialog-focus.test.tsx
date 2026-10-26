import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';

import { useDialogFocus } from './use-dialog-focus';

function Harness() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(open, ref, () => setOpen(false));
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <div role='dialog' ref={ref} tabIndex={-1}>
          <button>First</button>
          <button>Last</button>
        </div>
      )}
    </>
  );
}
it('traps forward/backward tab, closes with Escape and restores trigger focus', () => {
  render(<Harness />);
  const trigger = screen.getByText('Open');
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByText('First')).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(screen.getByText('Last')).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(screen.getByText('First')).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
