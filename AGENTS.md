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
- Database changes are applied by hand. `docs/PENDING-DATABASE.md`, while it exists, lists changes that are in the repo but not yet run on the live database: read it at the start of a session and apply them when the Lovable database tool is connected.
