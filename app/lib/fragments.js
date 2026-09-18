// NOTE: https://shopify.dev/docs/api/storefront/latest/queries/cart
export const CART_QUERY_FRAGMENT = `#graphql
  fragment Money on MoneyV2 {
    currencyCode
    amount
  }
  fragment CartLine on CartLine {
    id
    quantity
    attributes {
      key
      value
    }
    cost {
      totalAmount {
        ...Money
      }
      amountPerQuantity {
        ...Money
      }
      compareAtAmountPerQuantity {
        ...Money
      }
    }
    merchandise {
      ... on ProductVariant {
        id
        availableForSale
        compareAtPrice {
          ...Money
        }
        price {
          ...Money
        }
        requiresShipping
        title
        image {
          id
          url
          altText
          width
          height

        }
        product {
          handle
          title
          id
          vendor
          productOffers: metafield(namespace: "custom", key: "product_offers") {
            references(first: 8) {
              nodes {
                ... on Metaobject {
                  id
                  couponCode: field(key: "coupon_code") { value }
                  name: field(key: "name") { value }
                  description: field(key: "description") { value }
                }
              }
            }
          }
        }
        selectedOptions {
          name
          value
        }
      }
    }
    parentRelationship {
      parent {
        id
      }
    }
  }
  fragment CartLineComponent on ComponentizableCartLine {
    id
    quantity
    attributes {
      key
      value
    }
    cost {
      totalAmount {
        ...Money
      }
      amountPerQuantity {
        ...Money
      }
      compareAtAmountPerQuantity {
        ...Money
      }
    }
    merchandise {
      ... on ProductVariant {
        id
        availableForSale
        compareAtPrice {
          ...Money
        }
        price {
          ...Money
        }
        requiresShipping
        title
        image {
          id
          url
          altText
          width
          height
        }
        product {
          handle
          title
          id
          vendor
          productOffers: metafield(namespace: "custom", key: "product_offers") {
            references(first: 8) {
              nodes {
                ... on Metaobject {
                  id
                  couponCode: field(key: "coupon_code") { value }
                  name: field(key: "name") { value }
                  description: field(key: "description") { value }
                }
              }
            }
          }
        }
        selectedOptions {
          name
          value
        }
      }
    }
    lineComponents {
      ...CartLine
    }
  }
  fragment CartApiQuery on Cart {
    updatedAt
    id
    appliedGiftCards {
      id
      lastCharacters
      amountUsed {
        ...Money
      }
    }
    checkoutUrl
    totalQuantity
    buyerIdentity {
      countryCode
      customer {
        id
        email
        firstName
        lastName
        displayName
      }
      email
      phone
    }
    lines(first: $numCartLines) {
      nodes {
        ...CartLine
      }
      nodes {
        ...CartLineComponent
      }
    }
    cost {
      subtotalAmount {
        ...Money
      }
      totalAmount {
        ...Money
      }
      totalDutyAmount {
        ...Money
      }
      totalTaxAmount {
        ...Money
      }
    }
    note
    attributes {
      key
      value
    }
    discountCodes {
      code
      applicable
    }
  }
`;

const MENU_FRAGMENT = `#graphql
  fragment MenuItem on MenuItem {
    id
    resourceId
    tags
    title
    type
    url
  }
  fragment ChildMenuItem on MenuItem {
    ...MenuItem
  }
  fragment ParentMenuItem on MenuItem {
    ...MenuItem
    items {
      ...ChildMenuItem
    }
  }
  fragment Menu on Menu {
    id
    items {
      ...ParentMenuItem
    }
  }
`;

export const HEADER_QUERY = `#graphql
  fragment Shop on Shop {
    id
    name
    description
    primaryDomain {
      url
    }
    brand {
      logo {
        image {
          url
        }
      }
    }
  }
  query Header(
    $country: CountryCode
    $headerMenuHandle: String!
    $language: LanguageCode
  ) @inContext(language: $language, country: $country) {
    shop {
      ...Shop
    }
    menu(handle: $headerMenuHandle) {
      ...Menu
    }
  }
  ${MENU_FRAGMENT}
`;

/**
 * Lean menu-only query for branded routes. Identical shape to FOOTER_QUERY
 * but parametrised for the header menu handle. Deliberately excludes the
 * `shop { }` fragment present in HEADER_QUERY — branded routes don't need
 * shop analytics/brand data, and this keeps the extra payload minimal.
 */
export const MENU_QUERY = `#graphql
  query NavMenu(
    $country: CountryCode
    $menuHandle: String!
    $language: LanguageCode
  ) @inContext(language: $language, country: $country) {
    menu(handle: $menuHandle) {
      ...Menu
    }
  }
  ${MENU_FRAGMENT}
`;

export const FOOTER_QUERY = `#graphql
  query Footer(
    $country: CountryCode
    $footerMenuHandle: String!
    $language: LanguageCode
  ) @inContext(language: $language, country: $country) {
    menu(handle: $footerMenuHandle) {
      ...Menu
    }
  }
  ${MENU_FRAGMENT}
`;

/**
 * FooterV3's four columns, each backed by its own Shopify menu handle so
 * merchants can edit each column's links from Admin without a deploy.
 * A handle with no menu created yet resolves to `null` — FooterV3 falls
 * back to its static column for that slot, so this query is safe to run
 * before every menu exists.
 */
export const FOOTER_MENUS_QUERY = `#graphql
  query FooterMenus(
    $country: CountryCode
    $shopAllHandle: String!
    $knowMoreHandle: String!
    $supportHandle: String!
    $getInTouchHandle: String!
    $language: LanguageCode
  ) @inContext(language: $language, country: $country) {
    shopAll: menu(handle: $shopAllHandle) {
      ...Menu
    }
    knowMore: menu(handle: $knowMoreHandle) {
      ...Menu
    }
    support: menu(handle: $supportHandle) {
      ...Menu
    }
    getInTouch: menu(handle: $getInTouchHandle) {
      ...Menu
    }
  }
  ${MENU_FRAGMENT}
`;
