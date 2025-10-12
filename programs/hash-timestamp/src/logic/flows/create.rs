use anchor_lang::prelude::*;

use crate::logic::accounts::create::{create_hash_account, create_vote_account_for_hash};
use crate::logic::hash::derive::derive_hash;
use crate::logic::vote::derive::derive_vote;
use crate::state::HashSource;

#[derive(Clone, Debug)]
pub struct CreatedHashVote {
    pub hash_key: Pubkey,
    pub vote_key: Pubkey,
    pub hash_rent: u64,
}

pub fn create_hash_and_vote<'info>(
    program_id: &Pubkey,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    hash_account: &AccountInfo<'info>,
    vote_account: &AccountInfo<'info>,
    source: HashSource,
    hash: [u8; 32],
    voter: &Pubkey,
) -> Result<CreatedHashVote> {
    let derived_hash = derive_hash(program_id, &source, &hash);
    let hash_rent = create_hash_account(
        program_id,
        payer,
        system_program,
        hash_account,
        &derived_hash,
        source,
        hash,
    )?;

    let derived_vote = derive_vote(program_id, derived_hash.canonical_id(), voter);
    create_vote_account_for_hash(
        program_id,
        payer,
        system_program,
        hash_account,
        vote_account,
        &derived_hash,
        &derived_vote,
        hash_rent,
        0,
    )?;

    Ok(CreatedHashVote {
        hash_key: derived_hash.key,
        vote_key: derived_vote.key,
        hash_rent,
    })
}
