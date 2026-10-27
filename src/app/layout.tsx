import type { Metadata } from "next";
import Link from "next/link";
import styles from "./layout.module.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Copy pre-check · Tembusu Bank",
  description: "Checks UI copy for a fictional bank before compliance review.",
};

function BrandMark() {
  // A simple tree mark: the tembusu is a native Singapore tree.
  return (
    <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="currentColor" opacity="0.14" />
      <path d="M16 6c-4.4 0-8 3.2-8 7.2 0 3.4 2.6 6.2 6 7v5.3h4v-5.3c3.4-.8 6-3.6 6-7C24 9.2 20.4 6 16 6Z" fill="currentColor" />
    </svg>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a className={styles.skip} href="#main">
          Skip to main content
        </a>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            {/* Starts a new check. The checker catches the click (before Link navigates) to ask first
                when there are rounds to lose; without JavaScript it simply loads the start page. */}
            <Link href="/" className={styles.brand} data-home-link>
              <BrandMark />
              <span className={styles.bank}>Tembusu Bank</span>
              <span className={styles.divider} aria-hidden="true" />
              <span className={styles.product}>Copy pre-check</span>
              <span className="visually-hidden"> (start a new check)</span>
            </Link>
            <p className={styles.badge}>Internal tool · Fictional bank</p>
          </div>
        </header>
        <main id="main" className={styles.main}>
          {children}
        </main>
        <footer className={styles.footer}>
          <p>
            Tembusu Bank is fictional. The rules are loosely modelled on common banking practice and are not real
            MAS, legal or compliance requirements. Findings are for a person to review: this tool never approves copy.
          </p>
        </footer>
      </body>
    </html>
  );
}
