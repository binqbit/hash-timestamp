//! Historical proof structure, commitments and materialization decisions.
//!
//! This module only handles values. Account ownership, account reads and CPI
//! belong to runtime::restore; instruction orchestration belongs to the handler.

mod graph;
mod plan;
mod types;
mod validate;

use anchor_lang::prelude::*;
use std::collections::HashSet;

pub(crate) use graph::ProofGraph;
pub(crate) use plan::{RestorePlan, ValidatedProof};
pub use types::{
    RestoreAccountSnapshot, RestoreHashFingerprint, RestoreParameters, RestoreProofLink,
};

impl<'proof> ProofGraph<'proof> {
    /// Parse reachability and dependency order without reading on-chain accounts.
    pub(crate) fn parse(proof: &'proof [RestoreProofLink]) -> Result<Self> {
        graph::build_proof_graph(proof)
    }

    pub(crate) fn tip(&self) -> &RestoreProofLink {
        // Parsing guarantees a nonempty graph anchored at entry zero.
        self.entries[0].link
    }

    /// Existing indices are facts supplied by the runtime account preflight.
    pub(crate) fn validate(
        self,
        existing_indices: &HashSet<usize>,
    ) -> Result<ValidatedProof<'proof>> {
        validate::validate_graph(&self, existing_indices)?;
        Ok(ValidatedProof {
            graph: self,
            existing_indices: existing_indices.clone(),
        })
    }
}
