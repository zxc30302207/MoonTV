import { fireEvent, render, screen } from '@testing-library/react';

import MobileActionSheet from '../MobileActionSheet';

describe('MobileActionSheet synopsis', () => {
  it('renders untrusted descriptions as text and keeps Escape dismissal', () => {
    const close = jest.fn();
    const { container } = render(
      <MobileActionSheet
        isOpen
        onClose={close}
        title='作品'
        actions={[]}
        description='<script>alert(1)</script>'
      />
    );
    expect(screen.getByText('劇情簡介')).toBeInTheDocument();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(container.ownerDocument.querySelector('script')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
