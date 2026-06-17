import type { OpenMeter } from "@openmeter/sdk";
import type {
  BillingProvisionerPort,
  ProvisionBillingCustomerInput,
  ProvisionBillingCustomerResult,
} from "../../signer/webhook/ports/billing.js";
import { provisionBillingCustomer } from "./provision.js";

export type CreateOpenMeterBillingProvisionerInput = {
  client: OpenMeter;
  resolvePlanKey: (input: ProvisionBillingCustomerInput) => string | Promise<string>;
};

/**
 * Single-tenant or fixed-plan adapter: wraps an OpenMeter client as a BillingProvisionerPort.
 * Multi-tenant hosts should implement BillingProvisionerPort in the app layer instead.
 */
export function createOpenMeterBillingProvisioner(
  input: CreateOpenMeterBillingProvisionerInput,
): BillingProvisionerPort {
  return {
    async provisionCustomer(
      provisionInput: ProvisionBillingCustomerInput,
    ): Promise<ProvisionBillingCustomerResult> {
      const planKey = await input.resolvePlanKey(provisionInput);
      return provisionBillingCustomer(input.client, {
        clientId: provisionInput.clientId,
        externalUserId: provisionInput.externalUserId,
        planKey,
        displayName: provisionInput.displayName,
      });
    },
  };
}
