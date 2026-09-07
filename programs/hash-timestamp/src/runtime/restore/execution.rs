use anchor_lang::prelude::*;

use crate::protocol::restore::{RestorePlan, ValidatedProof};
use crate::runtime::{hash_record::NewHashRecord, record_lifecycle::RecordWriter};
use crate::ErrorCode;

use super::accounts::{AccountPair, ValidatedAccountPairs};

struct PlannedCreation<'info> {
    proof_index: usize,
    accounts: AccountPair<'info>,
    record: NewHashRecord,
}

/// An executable plan binds every pure decision to its validated destinations.
pub(crate) struct RestoreExecution<'info> {
    creations: Vec<PlannedCreation<'info>>,
}

impl<'info> ValidatedAccountPairs<'info> {
    pub(crate) fn plan(mut self, proof: ValidatedProof<'_>) -> Result<RestoreExecution<'info>> {
        let plan = RestorePlan::build(proof, &self.accounts.requested_indices())?;
        let mut creations = Vec::new();
        for creation in plan.into_creations() {
            let accounts = self
                .accounts
                .remove(creation.proof_index)
                .ok_or(ErrorCode::RestoreAccountsMisaligned)?;
            let link = creation.link;
            let record =
                NewHashRecord::historical(link.source.clone(), link.hash, link.created_at)?;
            creations.push(PlannedCreation {
                proof_index: creation.proof_index,
                accounts,
                record,
            });
        }
        // Finish all preparation before the first allocation or transfer.
        Ok(RestoreExecution { creations })
    }
}

impl<'info> RestoreExecution<'info> {
    pub(crate) fn len(&self) -> usize {
        self.creations.len()
    }

    pub(crate) fn execute(self, writer: &RecordWriter<'info>) -> Result<()> {
        for creation in self.creations {
            writer.create_with_initial_vote(
                &creation.accounts.hash,
                &creation.accounts.vote,
                creation.record,
            )?;
            crate::debug_log!(
                "checkpoint=flow.restore.recreated index={} hash={} vote={}",
                creation.proof_index,
                creation.accounts.hash.key(),
                creation.accounts.vote.key()
            );
        }
        Ok(())
    }
}
