import {
  DiscountClass,
  OrderDiscountSelectionStrategy,
  ProductDiscountSelectionStrategy,
} from "../generated/api";

const ELIGIBLE_TICKET_PRODUCT_IDS = [
  "gid://shopify/Product/7691296505952",
  "gid://shopify/Product/7599940698208",
  "gid://shopify/Product/7514010157152",
  "gid://shopify/Product/7400021786720",
  "gid://shopify/Product/7353942638688",
  "gid://shopify/Product/7353931759712",
  "gid://shopify/Product/7344872489056",
  "gid://shopify/Product/7274118512736",
  "gid://shopify/Product/7274116186208",
  "gid://shopify/Product/7274110189664",
  "gid://shopify/Product/7265522450528",
  "gid://shopify/Product/7206872416352",
];

const MEMBERSHIP_VARIANT_TO_TIER = {
  "gid://shopify/ProductVariant/42773692481632": 1,
  "gid://shopify/ProductVariant/42773692514400": 2,
  "gid://shopify/ProductVariant/42773692547168": 3,
  "gid://shopify/ProductVariant/42773692579936": 4,
};

const TICKET_PRICE = 69;
const SIGNUP_DISCOUNT_PER_TICKET = 10;
const MAX_TICKETS = 4;
const MEMBERSHIP_VALID_DAYS = 33;

export function cartLinesDiscountsGenerateRun(input) {
  const operations = [];

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product,
  );

  const hasOrderDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Order,
  );

  const eligibleTicketLines = input.cart.lines.filter((line) => {
    const merchandise = line.merchandise;

    return (
      merchandise.__typename === "ProductVariant" &&
      ELIGIBLE_TICKET_PRODUCT_IDS.includes(merchandise.product.id)
    );
  });

  const ticketQuantity = eligibleTicketLines.reduce(
    (total, line) => total + Number(line.quantity || 0),
    0,
  );

  if (ticketQuantity < 1) {
    return { operations: [] };
  }

  /**
   * DISCOUNT 1:
   * Existing member credits → free ticket(s)
   *
   * Rule:
   * membership_credits > 0
   * AND last_membership_renewal is within 33 days of current checkout time.
   *
   * Important:
   * We intentionally do NOT check membership_status here.
   * A cancelled member can still use remaining credits during their paid period.
   */
  if (hasProductDiscountClass) {
    const credits = Number(
      input.cart.buyerIdentity?.customer?.membershipCredits?.value || 0,
    );

    const lastMembershipRenewal =
      input.cart.buyerIdentity?.customer?.lastMembershipRenewal?.value || null;

    const currentDateTime = input.shop?.localTime?.date || null;

    const membershipStillValid =
      credits > 0 &&
      isMembershipWithinValidPeriod(lastMembershipRenewal, currentDateTime);

    if (membershipStillValid) {
      let remainingCredits = credits;
      const productTargets = [];

      for (const line of eligibleTicketLines) {
        if (remainingCredits <= 0) break;

        const quantityToDiscount = Math.min(line.quantity, remainingCredits);

        productTargets.push({
          cartLine: {
            id: line.id,
            quantity: quantityToDiscount,
          },
        });

        remainingCredits -= quantityToDiscount;
      }

      if (productTargets.length > 0) {
        operations.push({
          productDiscountsAdd: {
            candidates: [
              {
                message: "Membership free ticket",
                targets: productTargets,
                value: {
                  fixedAmount: {
                    amount: TICKET_PRICE.toFixed(2),
                    appliesToEachItem: true,
                  },
                },
              },
            ],
            selectionStrategy: ProductDiscountSelectionStrategy.First,
          },
        });
      }
    }
  }

  /**
   * DISCOUNT 2:
   * New membership in cart → signup discount
   */
  if (hasOrderDiscountClass) {
    const membershipTiersInCart = input.cart.lines
      .map((line) => {
        const merchandise = line.merchandise;

        if (merchandise.__typename !== "ProductVariant") return 0;

        return MEMBERSHIP_VARIANT_TO_TIER[merchandise.id] || 0;
      })
      .filter((tier) => tier > 0);

    const membershipTier = Math.max(0, ...membershipTiersInCart);

    if (membershipTier > 0) {
      const eligibleSignupQuantity = Math.min(
        ticketQuantity,
        membershipTier,
        MAX_TICKETS,
      );

      const signupDiscountAmount =
        eligibleSignupQuantity * SIGNUP_DISCOUNT_PER_TICKET;

      if (signupDiscountAmount > 0) {
        operations.push({
          orderDiscountsAdd: {
            candidates: [
              {
                message: "Puppy Yoga Membership Savings",
                targets: [
                  {
                    orderSubtotal: {
                      excludedCartLineIds: [],
                    },
                  },
                ],
                value: {
                  fixedAmount: {
                    amount: signupDiscountAmount.toFixed(2),
                  },
                },
              },
            ],
            selectionStrategy: OrderDiscountSelectionStrategy.First,
          },
        });
      }
    }
  }

  return { operations };
}

function isMembershipWithinValidPeriod(lastMembershipRenewal, currentDateTime) {
  if (!lastMembershipRenewal || !currentDateTime) return false;

  const renewalDate = new Date(lastMembershipRenewal);
  const now = new Date(currentDateTime);

  if (Number.isNaN(renewalDate.getTime())) return false;
  if (Number.isNaN(now.getTime())) return false;

  const diffMs = now.getTime() - renewalDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  return diffDays >= -1 && diffDays <= MEMBERSHIP_VALID_DAYS;
}