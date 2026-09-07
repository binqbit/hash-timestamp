//! Restore-specific account preflight and application of a verified plan.
//! Graph traversal and historical commitments remain in protocol::restore.

mod accounts;
mod execution;

pub(crate) use accounts::{validate_anchor, BoundAccountPairs};
