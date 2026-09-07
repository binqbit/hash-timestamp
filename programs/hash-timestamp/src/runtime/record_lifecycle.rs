//! Joint record and witness lifecycle operations.
//!
//! The writer binds an instruction's authenticated payer and System Program.
//! Construction only copies handles; validation and effects happen in operations.

use anchor_lang::prelude::*;

use super::hash_record::{self, NewHashRecord};
use super::vote_record::{self, VoteFunding};
use crate::protocol::address::{HashAddress, VoteAddress};
use crate::protocol::hash::HashSnapshot;
use crate::state::HashAccount;

pub(crate) struct RecordWriter<'info> {
    program_id: Pubkey,
    payer: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
}

impl<'info> RecordWriter<'info> {
    pub(crate) fn new(
        program_id: &Pubkey,
        payer: &Signer<'info>,
        system_program: &Program<'info, System>,
    ) -> Self {
        Self {
            program_id: *program_id,
            payer: payer.to_account_info(),
            system_program: system_program.to_account_info(),
        }
    }

    /// Create the hash and its initial witness as one transaction-scoped operation.
    pub(crate) fn create_with_initial_vote(
        &self,
        hash_account: &AccountInfo<'info>,
        vote_account: &AccountInfo<'info>,
        record: NewHashRecord,
    ) -> Result<()> {
        let program_id = &self.program_id;
        let payer = &self.payer;
        let system_program = &self.system_program;
        let voter = payer.key;
        let created_hash =
            hash_record::create(program_id, payer, system_program, hash_account, record)?;
        let hash_address = created_hash.address;
        let hash_rent = created_hash.rent;
        let vote_address = VoteAddress::derive(program_id, hash_address.canonical_id(), voter);

        vote_record::create(
            program_id,
            payer,
            system_program,
            hash_account,
            vote_account,
            &hash_address,
            &vote_address,
            VoteFunding::Initial { hash_rent },
        )?;
        crate::debug_log!(
            "checkpoint=record.created hash={} vote={} rent={}",
            hash_address.key,
            vote_address.key,
            hash_rent
        );
        Ok(())
    }

    /// Fund a later witness, then update the authoritative Anchor-decoded state.
    pub(crate) fn add_vote(
        &self,
        hash_account: &mut Account<'info, HashAccount>,
        vote_account: &AccountInfo<'info>,
        snapshot: &HashSnapshot,
    ) -> Result<()> {
        let hash_info = hash_account.to_account_info();
        let deposit = Rent::get()?.minimum_balance(hash_info.data_len());
        let hash_address =
            HashAddress::derive(&self.program_id, snapshot.source(), snapshot.hash());
        let vote_address = VoteAddress::derive(
            &self.program_id,
            hash_address.canonical_id(),
            self.payer.key,
        );

        // create checks that the snapshot-derived PDA is this exact hash account.
        vote_record::create(
            &self.program_id,
            &self.payer,
            &self.system_program,
            &hash_info,
            vote_account,
            &hash_address,
            &vote_address,
            VoteFunding::Additional { deposit },
        )?;
        hash_account.add_voter()?;
        Ok(())
    }
}
