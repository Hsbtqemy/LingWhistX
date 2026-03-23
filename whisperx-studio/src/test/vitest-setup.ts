import "@testing-library/jest-dom/vitest";

/** Active le mode `act` de React pour les tests Vitest + Testing Library. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- flag interne React
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
