const _ = require('lodash');
const { binance } = require('../helpers');
const queue = require('../cronjob/trailingTradeHelper/queue');

const {
  updateAccountInfo,
  getAccountInfoFromAPI
} = require('../cronjob/trailingTradeHelper/common');

const {
  getGridTradeLastOrder,
  updateGridTradeLastOrder,
  getManualOrder,
  saveManualOrder
} = require('../cronjob/trailingTradeHelper/order');

let userClean;

const setupUserWebsocket = async logger => {
  if (userClean) {
    logger.info('Existing opened socket for user found, clean first');
    userClean();
  }

  userClean = await binance.client.ws.user(evt => {
    const { eventType } = evt;

    logger.info({ evt }, 'Received new user activity');

    if (['balanceUpdate', 'account'].includes(eventType)) {
      getAccountInfoFromAPI(logger);
    }

    if (eventType === 'outboundAccountPosition') {
      const { balances, lastAccountUpdate } = evt;
      updateAccountInfo(logger, balances, lastAccountUpdate);
    }

    if (eventType === 'executionReport') {
      const {
        eventTime,
        symbol,
        side,
        orderStatus,
        orderType,
        stopPrice,
        price,
        orderId,
        quantity,
        isOrderWorking,
        totalQuoteTradeQuantity,
        totalTradeQuantity,
        orderTime: transactTime // Transaction time
      } = evt;
      logger.info(
        { symbol, evt, saveLog: true },
        `There is a new update in order. ${orderId} - ${side} - ${orderStatus}`
      );

      const checkLastOrder = async () => {
        const lastOrder = await getGridTradeLastOrder(
          logger,
          symbol,
          side.toLowerCase()
        );

        if (_.isEmpty(lastOrder) === false) {
          // Skip if the orderId is not match with the existing orderId
          // or Skip if the transaction time is older than the existing order transaction time
          // This is helpful when we received a delayed event for any reason
          if (
            orderId !== lastOrder.orderId ||
            transactTime < lastOrder.transactTime
          ) {
            return;
          }

          await updateGridTradeLastOrder(logger, symbol, side.toLowerCase(), {
            ...lastOrder,
            status: orderStatus,
            type: orderType,
            side,
            stopPrice,
            price,
            origQty: quantity,
            cummulativeQuoteQty: totalQuoteTradeQuantity,
            executedQty: totalTradeQuantity,
            isWorking: isOrderWorking,
            updateTime: eventTime,
            transactTime
          });
          logger.info(
            { symbol, lastOrder, saveLog: true },
            'The last order has been updated.'
          );

          queue.executeFor(logger, symbol);
        }
      };

      checkLastOrder();

      const checkManualOrder = async () => {
        const manualOrder = await getManualOrder(logger, symbol, orderId);

        if (_.isEmpty(manualOrder) === false) {
          await saveManualOrder(logger, symbol, orderId, {
            ...manualOrder,
            status: orderStatus,
            type: orderType,
            side,
            stopPrice,
            price,
            origQty: quantity,
            cummulativeQuoteQty: totalQuoteTradeQuantity,
            executedQty: totalTradeQuantity,
            isWorking: isOrderWorking,
            updateTime: eventTime
          });

          logger.info(
            { symbol, manualOrder, saveLog: true },
            'The manual order has been updated.'
          );

          queue.executeFor(logger, symbol);
        }
      };

      checkManualOrder();
    }
  });
};

module.exports = { setupUserWebsocket };
