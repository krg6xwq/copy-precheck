import styles from "./page.module.css";

// Placeholder until the Day 3 web page (paste copy → report → accept/dismiss).
export default function Home() {
  return (
    <main className={styles.main}>
      <h1>Copy pre-check</h1>
      <p>
        Checks UI copy for Tembusu Bank, a fictional bank, before compliance review. It flags
        personal data, risky phrasing and missing disclosures, for a person to review.
      </p>
      <p>
        The web page is coming soon. For now, use <code>npm run check</code> in the terminal.
      </p>
    </main>
  );
}
