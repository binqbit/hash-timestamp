use anchor_lang::prelude::*;

use crate::runtime::aggregate::{AggregateKind, VerifiedMembers};
use crate::runtime::{hash_record::NewHashRecord, record_lifecycle::RecordWriter};

#[derive(Accounts)]
pub struct Pack<'info> {
    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub hash_account: UncheckedAccount<'info>,

    /// CHECK: Created and initialized within this instruction.
    #[account(mut)]
    pub vote_info: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn pack<'info>(ctx: Context<'_, '_, '_, 'info, Pack<'info>>) -> Result<()> {
    let accounts = ctx.accounts;
    let members =
        VerifiedMembers::load(ctx.program_id, ctx.remaining_accounts, AggregateKind::Pack)?;
    let (source, hash) = members.compose()?;
    let record = NewHashRecord::now(source, hash)?;

    let writer = RecordWriter::new(ctx.program_id, &accounts.payer, &accounts.system_program);
    writer.create_with_initial_vote(&accounts.hash_account, &accounts.vote_info, record)?;
    crate::debug_log!(
        "checkpoint=instruction.done instruction=pack payer={} hash={}",
        accounts.payer.key(),
        accounts.hash_account.key()
    );
    Ok(())
}
