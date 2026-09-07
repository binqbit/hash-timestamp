use anchor_lang::prelude::*;

use crate::runtime::{hash_record, record_lifecycle::RecordWriter};
use crate::state::HashAccount;

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub hash_account: Account<'info, HashAccount>,

    /// CHECK: runtime::vote_record verifies the PDA and vacant System account,
    /// then creates and initializes the caller's vote.
    #[account(mut)]
    pub vote_info: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn vote(ctx: Context<Vote>) -> Result<()> {
    let accounts = ctx.accounts;
    let snapshot = hash_record::snapshot(ctx.program_id, &accounts.hash_account)?;
    let writer = RecordWriter::new(ctx.program_id, &accounts.user, &accounts.system_program);
    writer.add_vote(&mut accounts.hash_account, &accounts.vote_info, &snapshot)?;

    crate::debug_log!(
        "checkpoint=instruction.done instruction=vote hash={} voter={} voters={}",
        accounts.hash_account.key(),
        accounts.user.key(),
        accounts.hash_account.voters
    );
    Ok(())
}
