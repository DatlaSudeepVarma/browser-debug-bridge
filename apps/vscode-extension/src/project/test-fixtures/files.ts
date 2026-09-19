export const FIXTURE_PACKAGE_JSON = `{
  "name": "fixture-shop",
  "private": true,
  "dependencies": {
    "next": "15.0.0",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "typescript": "5.9.2"
  }
}
`;

export const FIXTURE_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "jsx": "preserve",
    "strict": true
  }
}
`;

export const FIXTURE_PNPM_LOCK = "lockfileVersion: '9.0'\n";

export const FIXTURE_CHECKOUT_PAGE = `export default function CheckoutPage() {
  return (
    <main>
      <h1>Checkout</h1>
      <button id="buy-now" className="buy-now" data-testid="buy-now">
        Buy now
      </button>
    </main>
  );
}
`;

export const FIXTURE_BUY_NOW_BUTTON = `export function BuyNowButton() {
  return (
    <button className="buy-now" data-testid="buy-now">
      Buy now
    </button>
  );
}
`;

export const FIXTURE_CHECKOUT_SERVICE = `export async function submitCheckout(): Promise<Response> {
  return fetch("/api/checkout");
}
`;

export const FIXTURE_CHECKOUT_CSS = `.buy-now {
  background: #ff4d00;
  color: #fff;
}
`;

export const FIXTURE_UNRELATED = `export function UnrelatedCard() {
  return <section>Unrelated</section>;
}
`;

export const FIXTURE_PROJECT_FILES: Record<string, string> = {
  "package.json": FIXTURE_PACKAGE_JSON,
  "tsconfig.json": FIXTURE_TSCONFIG,
  "pnpm-lock.yaml": FIXTURE_PNPM_LOCK,
  "src/app/checkout/page.tsx": FIXTURE_CHECKOUT_PAGE,
  "src/components/BuyNowButton.tsx": FIXTURE_BUY_NOW_BUTTON,
  "src/services/checkout.ts": FIXTURE_CHECKOUT_SERVICE,
  "src/styles/checkout.css": FIXTURE_CHECKOUT_CSS,
  "src/components/UnrelatedCard.tsx": FIXTURE_UNRELATED,
  "node_modules/react/index.js": "module.exports = {};",
  ".env": "SECRET=fake-should-never-be-read",
  "id_rsa": "-----BEGIN FAKE PRIVATE KEY-----",
  "credentials.json": "{\"token\":\"fake\"}",
};

export const FIXTURE_FOLDER_ROOT = "/workspace/shop";
export const FIXTURE_FOLDER_NAME = "shop";

export function createFixtureFileMap(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    ...FIXTURE_PROJECT_FILES,
    ...overrides,
  };
}
