use anchor_lang::prelude::*;

use crate::logic::ensure_hash_initialized;
use crate::state::HashAccount;

#[derive(Accounts)]
pub struct Verify<'info> {
    #[account(mut)]
    pub hash_account: Account<'info, HashAccount>,
}

pub fn verify(ctx: Context<Verify>) -> Result<()> {
    ensure_hash_initialized(&ctx.accounts.hash_account, ctx.program_id).map(|_| ())
}
