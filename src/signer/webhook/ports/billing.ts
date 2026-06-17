export type ProvisionBillingCustomerInput = {
  clientId: string;
  externalUserId: string;
  displayName?: string;
};

export type ProvisionBillingCustomerResult = {
  customerKey: string;
  customerId: string;
  subscriptionId: string;
  planKey: string;
  status: string;
  created: {
    customer: boolean;
    subscription: boolean;
  };
};

/**
 * Host-injected billing provisioner. The platform resolves tenant credentials,
 * plan keys, and backend clients before calling Konnect/BYO OpenMeter.
 */
export type BillingProvisionerPort = {
  provisionCustomer(
    input: ProvisionBillingCustomerInput,
  ): Promise<ProvisionBillingCustomerResult>;
};
