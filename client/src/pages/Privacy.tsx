export default function Privacy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-10">

        <div className="space-y-2">
          <h1 className="text-4xl font-bold">Privacy Policy</h1>
          <p className="text-muted-foreground text-sm">Last updated: May 20, 2025</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Overview</h2>
          <p className="leading-relaxed text-muted-foreground">
            LiteralLiterature ("we", "us", or "our") is committed to protecting your privacy.
            This Privacy Policy explains what information we collect, how we use it, and what
            rights you have over it. By using the Service you agree to the practices described
            here.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. Information We Collect</h2>
          <p className="leading-relaxed text-muted-foreground font-medium">Account information</p>
          <p className="leading-relaxed text-muted-foreground">
            When you sign in we receive basic profile information from your identity provider
            (name, email address, and a unique identifier). We do not store your password.
          </p>
          <p className="leading-relaxed text-muted-foreground font-medium mt-4">Uploaded content</p>
          <p className="leading-relaxed text-muted-foreground">
            PDFs you upload are stored on secure cloud storage. Text extracted from those PDFs
            is processed by an AI language model to generate image prompts. Generated images
            are also stored on cloud storage and linked to your account.
          </p>
          <p className="leading-relaxed text-muted-foreground font-medium mt-4">Usage data</p>
          <p className="leading-relaxed text-muted-foreground">
            We collect standard server logs including IP addresses, browser type, pages visited,
            and timestamps. This data is used to operate and improve the Service and is retained
            for up to 90 days.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. How We Use Your Information</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground pl-4">
            <li>To provide and operate the Service — processing your PDFs and generating images.</li>
            <li>To maintain and improve the Service — debugging, performance monitoring, and feature development.</li>
            <li>To communicate with you — support responses, policy updates, and service notices.</li>
            <li>To enforce our Terms of Service and protect the safety of users and third parties.</li>
            <li>To comply with legal obligations, including responding to lawful requests from authorities.</li>
          </ul>
          <p className="leading-relaxed text-muted-foreground">
            We do not sell your personal information or uploaded content to third parties. We
            do not use your uploaded documents to train AI models.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Data Storage and Security</h2>
          <p className="leading-relaxed text-muted-foreground">
            Your data is stored on cloud infrastructure with encryption at rest and in transit.
            Access to stored files is controlled through authenticated, time-limited URLs.
            We implement reasonable technical and organizational measures to protect your data
            against unauthorized access, loss, or destruction. However, no system is completely
            secure and we cannot guarantee absolute security.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Data Retention</h2>
          <p className="leading-relaxed text-muted-foreground">
            We retain your uploaded PDFs, extracted text, and generated images for as long as
            your account is active or as needed to provide the Service. If you delete your
            account, we will delete your associated files within 30 days, except where
            retention is required by law.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Third-Party Services</h2>
          <p className="leading-relaxed text-muted-foreground">
            The Service relies on the following third-party providers:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground pl-4">
            <li><strong>Cloud storage (AWS S3)</strong> — stores your uploaded PDFs and generated images.</li>
            <li><strong>AI model provider</strong> — receives extracted page text to generate image prompts and visual illustrations. Text sent is limited to the content of your uploaded documents.</li>
            <li><strong>Authentication provider</strong> — handles sign-in and provides your basic profile information.</li>
            <li><strong>Database provider</strong> — stores account metadata, book records, and processing status.</li>
          </ul>
          <p className="leading-relaxed text-muted-foreground">
            Each provider is subject to their own privacy policy. We select providers that
            maintain industry-standard security practices.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Your Rights</h2>
          <p className="leading-relaxed text-muted-foreground">
            Depending on your location you may have the following rights:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground pl-4">
            <li><strong>Access</strong> — request a copy of the personal data we hold about you.</li>
            <li><strong>Correction</strong> — request correction of inaccurate personal data.</li>
            <li><strong>Deletion</strong> — request deletion of your personal data and uploaded content.</li>
            <li><strong>Portability</strong> — request your data in a machine-readable format.</li>
            <li><strong>Objection</strong> — object to certain processing of your data.</li>
          </ul>
          <p className="leading-relaxed text-muted-foreground">
            To exercise any of these rights, contact us through the support channel provided
            in the application. We will respond within 30 days.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Children's Privacy</h2>
          <p className="leading-relaxed text-muted-foreground">
            The Service is not directed at children under the age of 13. We do not knowingly
            collect personal information from children under 13. If we become aware that a
            child under 13 has provided us with personal information, we will delete it promptly.
            If you believe a child under 13 has used the Service, please contact us immediately.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">9. Changes to This Policy</h2>
          <p className="leading-relaxed text-muted-foreground">
            We may update this Privacy Policy from time to time. The "Last updated" date at
            the top of this page reflects when changes were last made. We encourage you to
            review this policy periodically.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">10. Contact</h2>
          <p className="leading-relaxed text-muted-foreground">
            For privacy-related questions or to exercise your rights, please use the support
            contact provided within the application.
          </p>
        </section>

        <div className="pt-8 border-t border-border text-sm text-muted-foreground">
          <a href="/" className="hover:underline">← Back to LiteralLiterature</a>
        </div>
      </div>
    </div>
  );
}
