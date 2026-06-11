export default function WorkspaceLoading() {
  const block = "animate-pulse rounded-xl bg-white dark:bg-slate-800";

  return (
    <main className="min-h-[calc(100vh-8rem)] p-4 md:p-6">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-lg border border-white/15 bg-white p-5 dark:bg-slate-900/35">
          <div className={`${block} h-7 w-28`} />
          <div className="mt-5 space-y-3">
            <div className={`${block} h-11 w-full`} />
            <div className={`${block} h-11 w-full`} />
            <div className={`${block} h-24 w-full`} />
            <div className={`${block} h-32 w-full`} />
          </div>
        </aside>

        <section className="space-y-4">
          <div className="rounded-lg border border-white/15 bg-white p-5 dark:bg-slate-900/35">
            <div className={`${block} h-8 w-40`} />
            <div className={`${block} mt-3 h-4 w-72 max-w-full`} />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((card) => (
              <article
                key={card}
                className="rounded-lg border border-white/15 bg-white p-5 dark:bg-slate-900/35"
              >
                <div className={`${block} h-10 w-10 rounded-2xl`} />
                <div className={`${block} mt-4 h-5 w-28`} />
                <div className={`${block} mt-3 h-4 w-full`} />
                <div className={`${block} mt-2 h-4 w-4/5`} />
                <div className={`${block} mt-5 h-36 w-full`} />
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
