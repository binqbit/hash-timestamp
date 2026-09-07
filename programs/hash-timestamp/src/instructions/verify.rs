use anchor_lang::prelude::*;

use crate::runtime::hash_record;
use crate::state::HashAccount;

#[derive(Accounts)]
pub struct Verify<'info> {
    pub hash_account: Account<'info, HashAccount>,
}

pub fn verify(ctx: Context<Verify>) -> Result<()> {
    let verified = hash_record::snapshot(ctx.program_id, &ctx.accounts.hash_account)?;
    crate::debug_log!(
        "checkpoint=instruction.done instruction=verify hash={} voters={} created_at={}",
        ctx.accounts.hash_account.key(),
        verified.voters(),
        verified.created_at()
    );
    Ok(())
}
