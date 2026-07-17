export interface PaymentResult {
  success: boolean;
  transactionId: string;
  error?: string;
}

export interface PaymentGateway {
  charge(amount: number, paymentMethodId: string): Promise<PaymentResult>;
}

export class StripePaymentGateway implements PaymentGateway {
  async charge(amount: number, paymentMethodId: string): Promise<PaymentResult> {
    // In production, this calls Stripe API
    if (amount <= 0) {
      return { success: false, transactionId: '', error: 'Invalid amount' };
    }
    return {
      success: true,
      transactionId: `txn_${Date.now()}`,
    };
  }
}
