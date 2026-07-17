const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface CheckoutPayload {
  items: CartItem[];
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  paymentMethodId: string;
  couponCode?: string;
}

export interface CheckoutResult {
  orderId: string;
  total: number;
  status: 'pending' | 'confirmed' | 'failed';
  confirmationNumber: string;
}

export interface CheckoutError {
  message: string;
  code: string;
  field?: string;
}

export async function createCheckout(payload: CheckoutPayload): Promise<CheckoutResult> {
  const response = await fetch(`${API_BASE}/api/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Checkout failed' }));
    throw new Error(error.message);
  }

  return response.json();
}
