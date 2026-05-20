export default function AIDisclaimer() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-10">

        <div className="space-y-2">
          <h1 className="text-4xl font-bold">AI-Generated Content Disclaimer</h1>
          <p className="text-muted-foreground text-sm">Last updated: May 20, 2025</p>
        </div>

        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-5">
          <p className="text-blue-300 font-medium">
            All illustrations produced by LiteralLiterature are created entirely by artificial
            intelligence. They are not drawn, painted, or curated by human artists.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">What This Service Does</h2>
          <p className="leading-relaxed text-muted-foreground">
            LiteralLiterature reads the text on each page of your uploaded PDF, uses an AI
            language model to write a visual description of that page's scene, and then uses
            an AI image generation model to produce an illustration based on that description.
            The entire process — from text extraction to final image — is automated.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Accuracy and Representation</h2>
          <p className="leading-relaxed text-muted-foreground">
            AI-generated illustrations may not accurately represent the characters, scenes,
            settings, or events described in your document. Visual outputs may be:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground pl-4">
            <li>Inconsistent across pages, even when the same character appears multiple times.</li>
            <li>Historically, culturally, or factually inaccurate.</li>
            <li>Unexpected or unintended in style, composition, or content.</li>
            <li>Missing details or depicting elements not present in the source text.</li>
          </ul>
          <p className="leading-relaxed text-muted-foreground">
            We have implemented narrative context systems to improve consistency, but we cannot
            guarantee that AI will interpret text the same way a human artist would.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Religious, Cultural, and Sensitive Content</h2>
          <p className="leading-relaxed text-muted-foreground">
            If you upload religious texts, historical documents, or culturally significant
            works, the AI may depict figures, events, or symbols in ways that differ from
            traditional representations. LiteralLiterature does not endorse any particular
            religious or cultural interpretation. Generated images are artistic interpretations
            and should not be treated as authoritative or definitive representations.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">No Medical, Legal, or Professional Advice</h2>
          <p className="leading-relaxed text-muted-foreground">
            Generated illustrations are not a substitute for professional advice of any kind.
            If your document contains medical, legal, financial, or other professional content,
            the AI illustrations should not be relied upon for any professional purpose.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Copyright and Ownership of Generated Images</h2>
          <p className="leading-relaxed text-muted-foreground">
            The copyright status of AI-generated images is unsettled in most jurisdictions.
            Current guidance from the U.S. Copyright Office suggests that purely AI-generated
            images — with no direct human authorship — may not be eligible for copyright
            protection. This means:
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground pl-4">
            <li>You may not be able to copyright images generated from your uploaded document.</li>
            <li>Others may be able to use the same images without infringing your rights.</li>
            <li>Laws on this topic are changing rapidly and differ by country.</li>
          </ul>
          <p className="leading-relaxed text-muted-foreground">
            We strongly recommend consulting a qualified intellectual property attorney before
            using AI-generated images for commercial, publication, or licensing purposes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Bias and Limitations</h2>
          <p className="leading-relaxed text-muted-foreground">
            AI image generation models are trained on large datasets that may contain biases.
            Generated images may reflect or amplify societal biases related to race, gender,
            culture, religion, age, or ability. LiteralLiterature does not accept responsibility
            for biased outputs but takes reports of harmful bias seriously. If you encounter
            output you believe is harmful, please contact us.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">No Guarantee of Service</h2>
          <p className="leading-relaxed text-muted-foreground">
            AI model availability, processing quality, and output style may change over time
            as underlying models are updated by their providers. We do not guarantee that
            results produced today will match results produced in the future, even from the
            same input document.
          </p>
        </section>

        <div className="pt-8 border-t border-border text-sm text-muted-foreground">
          <a href="/" className="hover:underline">← Back to LiteralLiterature</a>
        </div>
      </div>
    </div>
  );
}
