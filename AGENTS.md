<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep SQL-nullable and overloaded RPC contract corrections in `src/lib/database-rpc.ts`; generated database types remain untouched and calls retain the original client and authorization.
- Database changes are applied by hand: a file under `supabase/migrations/` does not change the live database until its statements are run through the Lovable database tool and checked. If a change cannot be run, list it in `docs/PENDING-DATABASE.md` so the next session applies it.
