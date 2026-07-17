import { useState } from 'react';
import { createCheckout } from '../api/checkoutApi';
import type { CheckoutPayload, CheckoutError } from '../api/checkoutApi';

interface CheckoutPageProps {
  cartItems: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  onOrderComplete: (orderId: string) => void;
}

export function CheckoutPage({ cartItems, onOrderComplete }: CheckoutPageProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState({
    street: '',
    city: '',
    state: '',
    zip: '',
    country: 'US',
  });
  const [couponCode, setCouponCode] = useState('');

  const total = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload: CheckoutPayload = {
        items: cartItems,
        shippingAddress: address,
        paymentMethodId: 'pm_test_card',
        couponCode: couponCode || undefined,
      };

      const result = await createCheckout(payload);
      onOrderComplete(result.orderId);
    } catch (err) {
      const checkoutError = err as CheckoutError;
      setError(checkoutError.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="checkout-page">
      <h1>Checkout</h1>

      <div className="cart-summary">
        {cartItems.map((item) => (
          <div key={item.productId} className="cart-item">
            <span>{item.name}</span>
            <span>
              {item.quantity} x ${item.price.toFixed(2)} = $
              {(item.price * item.quantity).toFixed(2)}
            </span>
          </div>
        ))}
        <div className="cart-total">
          <strong>Total: ${total.toFixed(2)}</strong>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handleSubmit}>
        <h2>Shipping Address</h2>
        <input
          placeholder="Street"
          value={address.street}
          onChange={(e) => setAddress({ ...address, street: e.target.value })}
          required
        />
        <input
          placeholder="City"
          value={address.city}
          onChange={(e) => setAddress({ ...address, city: e.target.value })}
          required
        />
        <div className="row">
          <input
            placeholder="State"
            value={address.state}
            onChange={(e) => setAddress({ ...address, state: e.target.value })}
            required
          />
          <input
            placeholder="ZIP"
            value={address.zip}
            onChange={(e) => setAddress({ ...address, zip: e.target.value })}
            required
          />
        </div>

        <h2>Coupon</h2>
        <input
          placeholder="Coupon code"
          value={couponCode}
          onChange={(e) => setCouponCode(e.target.value)}
        />

        <button type="submit" disabled={loading}>
          {loading ? 'Processing...' : `Pay $${total.toFixed(2)}`}
        </button>
      </form>
    </div>
  );
}
