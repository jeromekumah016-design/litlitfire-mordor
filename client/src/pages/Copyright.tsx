export default function Copyright() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-10">

        <div className="space-y-2">
          <h1 className="text-4xl font-bold">Copyright & DMCA Policy</h1>
          <p className="text-muted-foreground text-sm">Last updated: May 20, 2025</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Our Position on Copyright</h2>
          <p className="leading-relaxed text-muted-foreground">
            LiteralLiterature respects the intellectual property rights of authors, publishers,
            and rights holders. We expect users to do the same. Uploading a PDF you do not own
            or do not have the right to use is a violation of our Terms of Service and may
            constitute copyright infringement under applicable law.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            Before uploading, ask yourself: <em>Do I own this document, or do I have a license
            or legal right to process it?</em> Public domain works, documents you authored,
            and documents for which you hold a license are generally acceptable. Scanned
            copyrighted books, academic papers behind paywalls, and commercial publications
            you do not own are not.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">DMCA Safe Harbor Notice</h2>
          <p className="leading-relaxed text-muted-foreground">
            LiteralLiterature complies with the Digital Millennium Copyright Act (DMCA). We
            qualify as a service provider under 17 U.S.C. § 512 and respond to valid notices
            of alleged copyright infringement by removing or disabling access to the identified
            material.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">How to Submit a Takedown Notice</h2>
          <p className="leading-relaxed text-muted-foreground">
            If you believe content on LiteralLiterature infringes your copyright, please send
            a written notice containing ALL of the following:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground pl-4">
            <li>Your name, address, telephone number, and email address.</li>
            <li>A description of the copyrighted work you claim has been infringed.</li>
            <li>A description of where the infringing material is located on our Service (URL or specific identifier).</li>
            <li>A statement that you have a good-faith belief that use of the material is not authorized by the copyright owner, its agent, or the law.</li>
            <li>A statement that the information in the notice is accurate and, under penalty of perjury, that you are the copyright owner or are authorized to act on their behalf.</li>
            <li>Your physical or electronic signature.</li>
          </ol>
          <p className="leading-relaxed text-muted-foreground">
            Send your notice to the support contact provided in the application. Notices that
            do not include all of the above elements may not be acted upon.
          </p>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-sm text-amber-400">
              <strong>Warning:</strong> Under 17 U.S.C. § 512(f), any person who knowingly
              misrepresents that material is infringing may be liable for damages, including
              costs and attorneys' fees.
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Counter-Notification</h2>
          <p className="leading-relaxed text-muted-foreground">
            If your content was removed and you believe it was removed in error or that you
            have the right to use the material, you may send a counter-notification containing:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground pl-4">
            <li>Your name, address, telephone number, and email address.</li>
            <li>Identification of the material that was removed and where it appeared before removal.</li>
            <li>A statement under penalty of perjury that you have a good-faith belief the material was removed by mistake or misidentification.</li>
            <li>A statement that you consent to the jurisdiction of your local federal court (or, if outside the US, any judicial district in which LiteralLiterature may be found).</li>
            <li>Your physical or electronic signature.</li>
          </ol>
          <p className="leading-relaxed text-muted-foreground">
            Upon receipt of a valid counter-notification we will forward it to the original
            complainant and may restore the material after 10–14 business days unless the
            complainant files a court action.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Repeat Infringer Policy</h2>
          <p className="leading-relaxed text-muted-foreground">
            In accordance with the DMCA and other applicable law, LiteralLiterature maintains
            a policy of terminating, in appropriate circumstances, accounts of users who are
            deemed to be repeat infringers. We also reserve the right to terminate accounts
            of users who infringe the intellectual property rights of others, even if there has
            not been a formal DMCA notice.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">AI-Generated Images and Copyright</h2>
          <p className="leading-relaxed text-muted-foreground">
            Images generated by this Service are created by artificial intelligence models.
            The copyright status of AI-generated images is an evolving area of law. In many
            jurisdictions, purely AI-generated works with no human authorship do not qualify
            for copyright protection. We make no representation that generated images are
            free from third-party copyright claims, and you assume all risk associated with
            how you use them.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            We do not intentionally train image generation models on specific copyrighted
            artworks, and our image generation API providers maintain their own content
            policies regarding style and likeness reproduction.
          </p>
        </section>

        <div className="pt-8 border-t border-border text-sm text-muted-foreground">
          <a href="/" className="hover:underline">← Back to LiteralLiterature</a>
        </div>
      </div>
    </div>
  );
}
