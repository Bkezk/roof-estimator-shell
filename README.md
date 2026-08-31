# Roof Estimator Shell

Build the foundation for an internal roofing estimating web 

app. It will replace a discontinued Windows program for 

estimating Duro-Last commercial roofing systems — the exact 

screens and calculation logic will be specified later from 

documentation of the old software, so keep this minimal and 

easy to restructure.

For now:

- Clean sidebar layout with placeholder sections for: 

  Bids, New Bid, and Admin/Settings

- Supabase enabled for data storage, but don't design 

  tables yet beyond a basic saved-bids list

- Keep all business logic separate from UI components, 

  since the calculation engine will be added later

- No authentication, no marketing pages — internal tool 

  for one contractor

Don't invent estimating features, pricing formulas, or 

form fields yet. Just the shell.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c13d501c-079a-45a8-b496-b026f4e6f451).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
