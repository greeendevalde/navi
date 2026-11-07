// NAVI firmware tests: stands in for QMK's split transactions (quantum/split_common/transactions.h). The test build
// has SPLIT_KEYBOARD off, so QMK's header isn't on its include path; own code that includes it unguarded finds this
// one. The same calls as QMK's split RPCs; there is no other half, so they go nowhere (navi_tests_stubs.c).
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#if defined(SPLIT_TRANSACTION_IDS_KB) || defined(SPLIT_TRANSACTION_IDS_USER)
#    define SPLIT_TRANSACTION_RPC
#endif

enum serial_transaction_id {
    GET_SLAVE_MATRIX_CHECKSUM,
    GET_SLAVE_MATRIX_DATA,
#ifdef SPLIT_TRANSACTION_IDS_KB
    SPLIT_TRANSACTION_IDS_KB,
#endif
#ifdef SPLIT_TRANSACTION_IDS_USER
    SPLIT_TRANSACTION_IDS_USER,
#endif
    NUM_TOTAL_TRANSACTIONS
};

typedef void (*slave_callback_t)(uint8_t initiator2target_buffer_size, const void *initiator2target_buffer, uint8_t target2initiator_buffer_size, void *target2initiator_buffer);

void transaction_register_rpc(int8_t transaction_id, slave_callback_t callback);

bool transaction_rpc_exec(int8_t transaction_id, uint8_t initiator2target_buffer_size, const void *initiator2target_buffer, uint8_t target2initiator_buffer_size, void *target2initiator_buffer);

#define transaction_rpc_send(transaction_id, initiator2target_buffer_size, initiator2target_buffer) transaction_rpc_exec(transaction_id, initiator2target_buffer_size, initiator2target_buffer, 0, NULL)
#define transaction_rpc_recv(transaction_id, target2initiator_buffer_size, target2initiator_buffer) transaction_rpc_exec(transaction_id, 0, NULL, target2initiator_buffer_size, target2initiator_buffer)
