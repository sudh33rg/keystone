import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CheckoutPage } from '../../src/pages/CheckoutPage';
import * as checkoutApi from '../../src/api/checkoutApi';

const mockItems = [
  { productId: '1', name: 'Widget A', price: 29.99, quantity: 2 },
  { productId: '2', name: 'Widget B', price: 49.99, quantity: 1 },
];

const mockOnOrderComplete = vi.fn();
const mockCreateCheckout = vi.mocked(checkoutApi.createCheckout);

describe('CheckoutPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders cart items and total', () => {
    render(<CheckoutPage cartItems={mockItems} onOrderComplete={mockOnOrderComplete} />);

    expect(screen.getByText('Widget A')).toBeInTheDocument();
    expect(screen.getByText('Widget B')).toBeInTheDocument();
    expect(screen.getByText('Total: $109.97')).toBeInTheDocument();
  });

  it('calls createCheckout on form submit', async () => {
    mockCreateCheckout.mockResolvedValue({
      orderId: 'ord_123',
      total: 109.97,
      status: 'confirmed',
      confirmationNumber: 'CN-456',
    });

    render(<CheckoutPage cartItems={mockItems} onOrderComplete={mockOnOrderComplete} />);

    fireEvent.change(screen.getByPlaceholderText('Street'), {
      target: { value: '123 Main St' },
    });
    fireEvent.change(screen.getByPlaceholderText('City'), {
      target: { value: 'Springfield' },
    });
    fireEvent.change(screen.getByPlaceholderText('State'), {
      target: { value: 'IL' },
    });
    fireEvent.change(screen.getByPlaceholderText('ZIP'), {
      target: { value: '62701' },
    });

    fireEvent.click(screen.getByRole('button', { name: /pay/i }));

    await waitFor(() => expect(mockCreateCheckout).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockOnOrderComplete).toHaveBeenCalledWith('ord_123')
    );
  });

  it('shows error when checkout fails', async () => {
    mockCreateCheckout.mockRejectedValue(new Error('Payment declined'));

    render(<CheckoutPage cartItems={mockItems} onOrderComplete={mockOnOrderComplete} />);

    fireEvent.change(screen.getByPlaceholderText('Street'), {
      target: { value: '123 Main St' },
    });
    fireEvent.change(screen.getByPlaceholderText('City'), {
      target: { value: 'Springfield' },
    });
    fireEvent.change(screen.getByPlaceholderText('State'), {
      target: { value: 'IL' },
    });
    fireEvent.change(screen.getByPlaceholderText('ZIP'), {
      target: { value: '62701' },
    });

    fireEvent.click(screen.getByRole('button', { name: /pay/i }));

    await waitFor(() =>
      expect(screen.getByText('Payment declined')).toBeInTheDocument()
    );
  });

  it('disables button while loading', () => {
    render(<CheckoutPage cartItems={mockItems} onOrderComplete={mockOnOrderComplete} />);

    fireEvent.change(screen.getByPlaceholderText('Street'), {
      target: { value: '123 Main St' },
    });
    fireEvent.change(screen.getByPlaceholderText('City'), {
      target: { value: 'Springfield' },
    });
    fireEvent.change(screen.getByPlaceholderText('State'), {
      target: { value: 'IL' },
    });
    fireEvent.change(screen.getByPlaceholderText('ZIP'), {
      target: { value: '62701' },
    });

    fireEvent.click(screen.getByRole('button', { name: /processing/i }));

    const button = screen.getByRole('button', { name: /processing/i });
    expect(button).toBeDisabled();
  });
});
