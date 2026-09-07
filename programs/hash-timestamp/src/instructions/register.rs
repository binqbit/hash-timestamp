use anchor_lang::prelude::*;

use crate::runtime::{hash_record::NewHashRecord, record_lifecycle::RecordWriter};
use crate::state::HashSource;

#[derive(Accounts)]
pub struct Register<'info> {
    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub hash_account: UncheckedAccount<'info>,

    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub vote_info: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn register(ctx: Context<Register>, hash: [u8; 32]) -> Result<()> {
    let accounts = ctx.accounts;
    let record = NewHashRecord::now(HashSource::register(), hash)?;

    let writer = RecordWriter::new(ctx.program_id, &accounts.user, &accounts.system_program);
    writer.create_with_initial_vote(&accounts.hash_account, &accounts.vote_info, record)?;
    crate::debug_log!(
        "checkpoint=instruction.done instruction=register hash={} voter={}",
        accounts.hash_account.key(),
        accounts.user.key()
    );
    Ok(())
}
